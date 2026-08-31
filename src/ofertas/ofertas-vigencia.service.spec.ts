import { Test, TestingModule } from '@nestjs/testing';
import { OfertasService } from './ofertas.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * `getVigenteConVencimiento` alimenta el aviso "HH:MM vence la promo de hoy"
 * del Home. Lo que se prueba acá es que no muestre una promo que la caja no
 * está aplicando, y que no invente una hora cuando la oferta no vence hoy.
 *
 * El filtro por día/franja se resuelve en Node y no en SQL (`diasAplicables`
 * es un CSV y las horas son strings), así que es exactamente esa parte la que
 * necesita test.
 */
describe('OfertasService.getVigenteConVencimiento', () => {
  let service: OfertasService;
  let prisma: any;

  /** Martes 20:00 hora local. `getDay()` = 2, que en el schema también es 2. */
  const MARTES_20_00 = new Date(2026, 7, 25, 20, 0, 0, 0);

  const BASE = {
    id: 'of-1',
    nombre: 'Promo',
    diasAplicables: '1,2,3,4,5,6,7',
    horaInicio: null as string | null,
    horaFin: null as string | null,
    fechaFin: null as Date | null,
  };

  const dado = (...ofertas: Partial<typeof BASE>[]) => {
    prisma.oferta.findMany.mockResolvedValue(
      ofertas.map((o, i) => ({ ...BASE, id: `of-${i + 1}`, ...o })),
    );
  };

  beforeEach(async () => {
    prisma = { oferta: { findMany: jest.fn().mockResolvedValue([]) } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [OfertasService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(OfertasService);
  });

  it('devuelve null cuando no hay ninguna oferta candidata', async () => {
    expect(await service.getVigenteConVencimiento(MARTES_20_00)).toBeNull();
  });

  it('filtra en SQL por estado, activa y rango de fechas', async () => {
    await service.getVigenteConVencimiento(MARTES_20_00);

    const [{ where }] = prisma.oferta.findMany.mock.calls[0];
    expect(where.activa).toBe(true);
    expect(where.estado).toBe('ACTIVA');
    expect(where.fechaInicio).toEqual({ lte: MARTES_20_00 });
    expect(where.OR).toEqual([
      { fechaFin: null },
      { fechaFin: { gte: MARTES_20_00 } },
    ]);
  });

  it('descarta la que no aplica al día de la semana', async () => {
    dado({ diasAplicables: '5,6,7', horaInicio: '19:00', horaFin: '23:59' });

    expect(await service.getVigenteConVencimiento(MARTES_20_00)).toBeNull();
  });

  it('descarta la que todavía no arrancó su franja', async () => {
    dado({ horaInicio: '21:00', horaFin: '23:59' });

    expect(await service.getVigenteConVencimiento(MARTES_20_00)).toBeNull();
  });

  it('descarta la que ya terminó su franja', async () => {
    dado({ horaInicio: '12:00', horaFin: '16:00' });

    expect(await service.getVigenteConVencimiento(MARTES_20_00)).toBeNull();
  });

  it('devuelve el fin de la franja como hora de vencimiento', async () => {
    dado({ nombre: 'Martes 2x1', horaInicio: '19:00', horaFin: '23:30' });

    expect(await service.getVigenteConVencimiento(MARTES_20_00)).toEqual({
      id: 'of-1',
      nombre: 'Martes 2x1',
      hasta: '23:30',
      minutosRestantes: 210,
    });
  });

  it('cuenta bien los minutos de una franja que cruza medianoche', async () => {
    dado({ horaInicio: '19:00', horaFin: '02:00' });

    const vigente = await service.getVigenteConVencimiento(MARTES_20_00);

    expect(vigente?.hasta).toBe('02:00');
    // De las 20:00 a las 02:00 hay 6 horas, no -1080 minutos.
    expect(vigente?.minutosRestantes).toBe(360);
  });

  it('no toma horaFin como vencimiento si no hay horaInicio', async () => {
    // El calculador solo respeta la franja con las dos horas cargadas: sin
    // horaInicio la oferta corre todo el día y esa hora no corta nada.
    dado({ horaFin: '22:00' });

    expect(await service.getVigenteConVencimiento(MARTES_20_00)).toEqual({
      id: 'of-1',
      nombre: 'Promo',
      hasta: null,
      minutosRestantes: null,
    });
  });

  it('usa fechaFin cuando cae antes que el fin de la franja', async () => {
    dado({
      horaInicio: '19:00',
      horaFin: '23:30',
      fechaFin: new Date(2026, 7, 25, 21, 15, 0, 0),
    });

    const vigente = await service.getVigenteConVencimiento(MARTES_20_00);

    expect(vigente?.hasta).toBe('21:15');
    expect(vigente?.minutosRestantes).toBe(75);
  });

  it('entre varias vigentes se queda con la que vence primero', async () => {
    dado(
      { nombre: 'Larga', horaInicio: '19:00', horaFin: '23:59' },
      { nombre: 'Corta', horaInicio: '19:00', horaFin: '20:30' },
      { nombre: 'Media', horaInicio: '19:00', horaFin: '22:00' },
    );

    const vigente = await service.getVigenteConVencimiento(MARTES_20_00);

    expect(vigente?.nombre).toBe('Corta');
    expect(vigente?.hasta).toBe('20:30');
  });

  it('una sin vencimiento no le gana a una que sí vence', async () => {
    dado(
      { nombre: 'Todo el día' },
      { nombre: 'Hasta las 22', horaInicio: '19:00', horaFin: '22:00' },
    );

    expect((await service.getVigenteConVencimiento(MARTES_20_00))?.nombre).toBe(
      'Hasta las 22',
    );
  });

  it('el domingo cuenta como día 7, no como 0', async () => {
    const domingo = new Date(2026, 7, 30, 20, 0, 0, 0);
    expect(domingo.getDay()).toBe(0);

    dado({ diasAplicables: '7', horaInicio: '19:00', horaFin: '23:00' });

    expect(await service.getVigenteConVencimiento(domingo)).not.toBeNull();
  });
});
