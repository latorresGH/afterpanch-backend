import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { NegocioConfigService, CLAVE_CERRADO_FORZADO } from './config.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * El cálculo de "¿está abierto?" es la ÚNICA fuente de verdad del sistema:
 * lo consumen el menú público, el Home del admin y —desde que se borró la
 * copia manual que vivía adentro— `PedidosService.crearPedido`. Un error acá
 * no es un cartel mal puesto: es el local rechazando pedidos reales.
 *
 * Todo se prueba contra instantes UTC explícitos (`-03:00`) y no con
 * `setHours`, para que el resultado no dependa de la TZ de la máquina que
 * corra los tests. Argentina no tiene DST desde 2009, así que el offset es
 * fijo.
 */
describe('NegocioConfigService.estaAbierto', () => {
  let service: NegocioConfigService;
  let findMany: jest.Mock;
  let obtener: jest.SpyInstance;

  beforeEach(async () => {
    findMany = jest.fn().mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NegocioConfigService,
        {
          provide: PrismaService,
          useValue: { configuracion: {}, horarioDia: { findMany } },
        },
      ],
    }).compile();

    service = module.get(NegocioConfigService);
    // onModuleInit no corre en el test: no hay DB que inicializar.
    obtener = jest.spyOn(service, 'obtener');
    // Por defecto el cierre manual está apagado.
    obtener.mockResolvedValue('false');
  });

  const DIAS = {
    LUNES: 0,
    MARTES: 1,
    MIERCOLES: 2,
    JUEVES: 3,
    VIERNES: 4,
    SABADO: 5,
    DOMINGO: 6,
  };

  const fila = (dia: number, desde: string, hasta: string, abierto = true) => ({
    id: `h-${dia}`,
    dia,
    abierto,
    desde,
    hasta,
    updatedAt: new Date(),
  });

  /** La semana entera con el mismo horario, como la deja la migración. */
  const semanaUniforme = (desde: string, hasta: string, abierto = true) =>
    [0, 1, 2, 3, 4, 5, 6].map((d) => fila(d, desde, hasta, abierto));

  /** `findMany` filtra por los días pedidos, igual que Prisma. */
  const configurar = (filas: ReturnType<typeof fila>[]) => {
    findMany.mockImplementation(async ({ where }: any) => {
      const pedidos: number[] = where.dia.in;
      return filas.filter((f) => pedidos.includes(f.dia));
    });
  };

  const forzado = (valor: boolean) => {
    obtener.mockImplementation(async (clave: string) =>
      clave === CLAVE_CERRADO_FORZADO ? String(valor) : null,
    );
  };

  const pad = (n: number) => String(n).padStart(2, '0');

  /** Un instante que en hora de Mendoza cae en esa fecha y hora. */
  const enMendoza = (fecha: string, hora: number, minutos = 0) =>
    new Date(`${fecha}T${pad(hora)}:${pad(minutos)}:00-03:00`);

  // 2026-08-20 es JUEVES.
  const elJueves = (hora: number, minutos = 0) =>
    enMendoza('2026-08-20', hora, minutos);

  describe('turno normal (21:00 a 23:30)', () => {
    beforeEach(() => configurar(semanaUniforme('21:00', '23:30')));

    it.each([
      [20, 59, false],
      [21, 0, true], // la apertura es inclusiva
      [22, 30, true],
      [23, 29, true],
      [23, 30, false], // el cierre es exclusivo
      [23, 59, false],
      [3, 0, false],
    ])('a las %i:%i => abierto: %s', async (h, m, esperado) => {
      const { abierto } = await service.estaAbierto(elJueves(h, m));
      expect(abierto).toBe(esperado);
    });
  });

  describe('turno que cruza medianoche (22:00 a 02:00)', () => {
    beforeEach(() => configurar(semanaUniforme('22:00', '02:00')));

    it.each([
      [21, 59, false],
      [22, 0, true],
      [23, 30, true],
      [0, 30, true], // ya es el día siguiente y sigue abierto
      [1, 59, true],
      [2, 0, false],
      [12, 0, false],
    ])('a las %i:%i => abierto: %s', async (h, m, esperado) => {
      const { abierto } = await service.estaAbierto(elJueves(h, m));
      expect(abierto).toBe(esperado);
    });
  });

  it('un turno que NO cruza (after de 05:00 a 08:00) no arrastra nada', async () => {
    configurar(semanaUniforme('05:00', '08:00'));

    await expect(service.estaAbierto(elJueves(6))).resolves.toMatchObject({
      abierto: true,
    });
    await expect(service.estaAbierto(elJueves(9))).resolves.toMatchObject({
      abierto: false,
    });
  });

  it('devuelve los horarios configurados junto al estado', async () => {
    configurar(semanaUniforme('21:00', '23:30'));

    const res = await service.estaAbierto(elJueves(22));

    expect(res).toMatchObject({
      abierto: true,
      horaApertura: '21:00',
      horaCierre: '23:30',
      motivo: null,
      mensajeCierre: null,
      forzado: false,
    });
    expect(res.horaActual).toMatch(/^\d{2}:\d{2}$/);
  });

  describe('el horario es POR DÍA, no global', () => {
    // Sábado 12:00–01:30, domingo 12:00–23:30, lunes cerrado.
    const semana = () =>
      configurar([
        fila(DIAS.SABADO, '12:00', '01:30'),
        fila(DIAS.DOMINGO, '12:00', '23:30'),
        fila(DIAS.LUNES, '19:00', '23:30', false),
      ]);

    it('el sábado al mediodía está abierto y el lunes al mediodía no', async () => {
      semana();

      // 2026-09-05 es sábado; 2026-09-07 es lunes.
      await expect(
        service.estaAbierto(enMendoza('2026-09-05', 12, 30)),
      ).resolves.toMatchObject({ abierto: true });

      await expect(
        service.estaAbierto(enMendoza('2026-09-07', 12, 30)),
      ).resolves.toMatchObject({ abierto: false });
    });

    it('un día marcado cerrado se distingue de estar fuera de horario', async () => {
      semana();

      const lunes = await service.estaAbierto(enMendoza('2026-09-07', 20, 0));
      expect(lunes).toMatchObject({
        abierto: false,
        motivo: 'DIA_CERRADO',
        diaAbierto: false,
        mensajeCierre: 'Estamos cerrados. Hoy no abrimos.',
      });

      const domingoTemprano = await service.estaAbierto(
        enMendoza('2026-09-06', 10, 0),
      );
      expect(domingoTemprano).toMatchObject({
        abierto: false,
        motivo: 'FUERA_DE_HORARIO',
        diaAbierto: true,
        mensajeCierre: 'Estamos cerrados. Horario de atención: 12:00 a 23:30',
      });
    });

    it('el spillover: a la 01:00 del domingo sigue abierto POR EL TURNO DEL SÁBADO', async () => {
      // Éste es el caso que el horario global no podía expresar: el domingo
      // abre 12:00, así que mirando solo el día de hoy diría "cerrado".
      semana();

      const res = await service.estaAbierto(enMendoza('2026-09-06', 1, 0));

      expect(res.abierto).toBe(true);
      // Y a las 01:30 en punto el turno del sábado ya terminó.
      await expect(
        service.estaAbierto(enMendoza('2026-09-06', 1, 30)),
      ).resolves.toMatchObject({ abierto: false });
    });

    it('el turno de ayer NO arrastra si ayer estaba marcado cerrado', async () => {
      configurar([
        fila(DIAS.SABADO, '12:00', '01:30', false), // sábado de descanso
        fila(DIAS.DOMINGO, '12:00', '23:30'),
      ]);

      await expect(
        service.estaAbierto(enMendoza('2026-09-06', 1, 0)),
      ).resolves.toMatchObject({ abierto: false });
    });

    it('el turno de ayer NO arrastra si ayer no cruzaba la medianoche', async () => {
      configurar([
        fila(DIAS.SABADO, '12:00', '23:00'), // cierra el mismo día
        fila(DIAS.DOMINGO, '12:00', '23:30'),
      ]);

      await expect(
        service.estaAbierto(enMendoza('2026-09-06', 1, 0)),
      ).resolves.toMatchObject({ abierto: false });
    });

    it('consulta solo HOY y AYER, no la semana entera', async () => {
      semana();
      await service.estaAbierto(enMendoza('2026-09-06', 13, 0)); // domingo

      expect(findMany).toHaveBeenCalledWith({
        where: { dia: { in: [DIAS.DOMINGO, DIAS.SABADO] } },
      });
    });
  });

  describe('cierre manual (forzado)', () => {
    it('cierra el local aunque el horario diga que está abierto', async () => {
      configurar(semanaUniforme('00:00', '23:59'));
      forzado(true);

      const res = await service.estaAbierto(elJueves(13));

      expect(res).toMatchObject({
        abierto: false,
        motivo: 'FORZADO',
        forzado: true,
      });
      expect(res.mensajeCierre).toContain('temporalmente');
    });

    it('gana incluso sobre el fail-open de un día sin configurar', async () => {
      // Sin filas el local queda abierto por fail-open; el forzado igual cierra.
      configurar([]);
      forzado(true);

      await expect(service.estaAbierto(elJueves(13))).resolves.toMatchObject({
        abierto: false,
        motivo: 'FORZADO',
      });
    });

    it('apagado no cambia nada', async () => {
      configurar(semanaUniforme('21:00', '23:30'));
      forzado(false);

      await expect(service.estaAbierto(elJueves(22))).resolves.toMatchObject({
        abierto: true,
        forzado: false,
      });
    });

    it('cualquier valor que no sea exactamente "true" se lee como apagado', async () => {
      configurar(semanaUniforme('21:00', '23:30'));
      obtener.mockResolvedValue('si');

      await expect(service.estaAbierto(elJueves(22))).resolves.toMatchObject({
        abierto: true,
        forzado: false,
      });
    });
  });

  describe('fail-open: una config incompleta no cierra el local', () => {
    it('sin ninguna fila para hoy asume abierto', async () => {
      // Preferible dejar entrar un pedido de más que cerrar el local por una
      // config incompleta. Es lo que sostiene un deploy a mitad de camino.
      configurar([]);

      const res = await service.estaAbierto(elJueves(4));

      expect(res.abierto).toBe(true);
      expect(res.horaApertura).toBeNull();
      expect(res.horaCierre).toBeNull();
    });

    it('con un horario corrupto en la DB también asume abierto', async () => {
      configurar([fila(DIAS.JUEVES, '', 'nueve')]);

      await expect(service.estaAbierto(elJueves(4))).resolves.toMatchObject({
        abierto: true,
        horaApertura: null,
      });
    });

    it('una hora fuera de rango (25:00) cuenta como corrupta', async () => {
      configurar([fila(DIAS.JUEVES, '25:00', '99:99')]);

      await expect(service.estaAbierto(elJueves(4))).resolves.toMatchObject({
        abierto: true,
      });
    });

    it('si el día de AYER está corrupto, hoy se evalúa igual', async () => {
      configurar([
        fila(DIAS.MIERCOLES, 'x', 'y'),
        fila(DIAS.JUEVES, '21:00', '23:30'),
      ]);

      await expect(service.estaAbierto(elJueves(22))).resolves.toMatchObject({
        abierto: true,
      });
      await expect(service.estaAbierto(elJueves(4))).resolves.toMatchObject({
        abierto: false,
      });
    });
  });

  it('resuelve el día en la zona horaria del negocio, no en la del proceso', async () => {
    // 2026-09-07T02:30Z son las 23:30 del DOMINGO 6 en Mendoza (UTC-3). Si el
    // día saliera de `getDay()` sobre la TZ del proceso o de UTC, esto daría
    // lunes y el resultado se invertiría.
    configurar([
      fila(DIAS.DOMINGO, '19:00', '23:59'),
      fila(DIAS.LUNES, '19:00', '23:59', false),
    ]);

    const res = await service.estaAbierto(new Date('2026-09-07T02:30:00Z'));

    expect(res.dia).toBe(DIAS.DOMINGO);
    expect(res.horaActual).toBe('23:30');
    expect(res.abierto).toBe(true);
  });
});

describe('NegocioConfigService.actualizarDia', () => {
  let service: NegocioConfigService;
  let upsert: jest.Mock;

  beforeEach(async () => {
    upsert = jest.fn().mockImplementation(async ({ create }) => create);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NegocioConfigService,
        {
          provide: PrismaService,
          useValue: { configuracion: {}, horarioDia: { upsert } },
        },
      ],
    }).compile();

    service = module.get(NegocioConfigService);
  });

  const dia = { abierto: true, desde: '19:00', hasta: '00:30' };

  it('hace upsert para que un día borrado a mano se vuelva a crear', async () => {
    await service.actualizarDia(5, dia);

    expect(upsert).toHaveBeenCalledWith({
      where: { dia: 5 },
      update: { abierto: true, desde: '19:00', hasta: '00:30' },
      create: { dia: 5, abierto: true, desde: '19:00', hasta: '00:30' },
    });
  });

  it.each([-1, 7, 1.5])('rechaza el día %s', async (invalido) => {
    await expect(service.actualizarDia(invalido as number, dia)).rejects.toThrow(
      BadRequestException,
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rechaza desde === hasta (es un dedazo, no "24hs")', async () => {
    await expect(
      service.actualizarDia(0, { abierto: true, desde: '19:00', hasta: '19:00' }),
    ).rejects.toThrow(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('acepta un turno que cruza la medianoche', async () => {
    await expect(
      service.actualizarDia(0, { abierto: true, desde: '19:00', hasta: '00:30' }),
    ).resolves.toBeDefined();
  });
});
