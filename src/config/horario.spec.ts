import { Test, TestingModule } from '@nestjs/testing';
import { NegocioConfigService } from './config.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * El cálculo de "¿está abierto?" vivía en el controller (con 9 console.log por
 * request). Al moverlo al service quedó testeable sin levantar HTTP, y lo puede
 * reusar el Home en vez de repetirlo.
 */
describe('NegocioConfigService.estaAbierto', () => {
  let service: NegocioConfigService;
  let obtener: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NegocioConfigService,
        { provide: PrismaService, useValue: { configuracion: {} } },
      ],
    }).compile();

    service = module.get(NegocioConfigService);
    // onModuleInit no corre en el test: no hay DB que inicializar.
    obtener = jest.spyOn(service, 'obtener');
  });

  const configurar = (apertura: string | null, cierre: string | null) => {
    obtener.mockImplementation(async (clave: string) =>
      clave === 'hora_apertura' ? apertura : cierre,
    );
  };

  /** Una fecha con esa hora local (el proceso corre en TZ argentina). */
  const aLas = (hora: number, minutos = 0) => {
    const d = new Date(2026, 7, 20);
    d.setHours(hora, minutos, 0, 0);
    return d;
  };

  describe('turno normal (21:00 a 23:30)', () => {
    beforeEach(() => configurar('21:00', '23:30'));

    it.each([
      [20, 59, false],
      [21, 0, true], // la apertura es inclusiva
      [22, 30, true],
      [23, 29, true],
      [23, 30, false], // el cierre es exclusivo
      [23, 59, false],
      [3, 0, false],
    ])('a las %i:%i => abierto: %s', async (h, m, esperado) => {
      const { abierto } = await service.estaAbierto(aLas(h, m));
      expect(abierto).toBe(esperado);
    });
  });

  describe('turno que cruza medianoche (after: 05:00 a 08:00 no cruza; 22:00 a 02:00 sí)', () => {
    beforeEach(() => configurar('22:00', '02:00'));

    it.each([
      [21, 59, false],
      [22, 0, true],
      [23, 30, true],
      [0, 30, true], // ya es el día siguiente y sigue abierto
      [1, 59, true],
      [2, 0, false],
      [12, 0, false],
    ])('a las %i:%i => abierto: %s', async (h, m, esperado) => {
      const { abierto } = await service.estaAbierto(aLas(h, m));
      expect(abierto).toBe(esperado);
    });
  });

  it('devuelve los horarios configurados junto al estado', async () => {
    configurar('21:00', '23:30');

    const res = await service.estaAbierto(aLas(22));

    expect(res).toMatchObject({
      abierto: true,
      horaApertura: '21:00',
      horaCierre: '23:30',
    });
    expect(res.horaActual).toMatch(/^\d{2}:\d{2}$/);
  });

  it('sin horario configurado asume abierto', async () => {
    // Preferible dejar entrar un pedido de más que cerrar el local por una
    // config incompleta.
    configurar(null, null);

    const res = await service.estaAbierto(aLas(4));

    expect(res.abierto).toBe(true);
    expect(res.horaApertura).toBeNull();
  });

  it('si falta solo uno de los dos, también asume abierto', async () => {
    configurar('21:00', null);
    await expect(service.estaAbierto(aLas(4))).resolves.toMatchObject({
      abierto: true,
    });
  });
});
