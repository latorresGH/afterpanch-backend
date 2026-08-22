import { Test, TestingModule } from '@nestjs/testing';
import { PedidosService } from './pedidos.service';
import { PrismaService } from '../prisma/prisma.service';
import { OfertasCalculatorService } from '../ofertas/ofertas-calculator.service';
import { NegocioConfigService } from '../config/config.service';
import { PedidosGateway } from './pedidos.gateway';

/**
 * Regresión del gráfico semanal del Home.
 *
 * La primera versión pedía el día como timestamp y lo pasaba por `new Date()`
 * antes de armar la clave del Map. `date_trunc` devuelve `timestamp without
 * time zone`, el driver lo hidrata como si fuera UTC, y en un server en UTC-3
 * el 11/07 00:00 local terminaba siendo el 10/07 21:00: la clave caía en el
 * día anterior, no matcheaba contra ninguna de las que arma el relleno y el
 * gráfico salía todo en cero aunque hubiera ventas. Se detectó recién al
 * correrlo contra Postgres de verdad, porque no había test que lo cubriera.
 */
describe('PedidosService.getFacturacionPorDia', () => {
  let service: PedidosService;
  let prisma: { $queryRaw: jest.Mock };

  // 20/08/2026 a media tarde: la ventana de 7 días va del 14 al 20.
  const AHORA = new Date(2026, 7, 20, 15, 30, 0);

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PedidosService,
        { provide: PrismaService, useValue: prisma },
        { provide: OfertasCalculatorService, useValue: {} },
        { provide: NegocioConfigService, useValue: {} },
        { provide: PedidosGateway, useValue: {} },
      ],
    }).compile();

    service = module.get<PedidosService>(PedidosService);
  });

  it('devuelve un día por cada jornada de la ventana, hoy incluido', async () => {
    const { dias } = await service.getFacturacionPorDia(7, AHORA);

    expect(dias.map((d) => d.fecha)).toEqual([
      '2026-08-14',
      '2026-08-15',
      '2026-08-16',
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
    ]);
  });

  it('asigna cada fila al día que le corresponde, sin correrla', async () => {
    // Tal como vuelve del SQL: el día ya viene como texto 'YYYY-MM-DD'.
    prisma.$queryRaw.mockResolvedValue([
      { dia: '2026-08-18', monto: 12500, pedidos: 3n },
      { dia: '2026-08-20', monto: 4000, pedidos: 1n },
    ]);

    const { dias, total, max } = await service.getFacturacionPorDia(7, AHORA);
    const porFecha = Object.fromEntries(dias.map((d) => [d.fecha, d]));

    expect(porFecha['2026-08-18']).toMatchObject({ monto: 12500, pedidos: 3 });
    expect(porFecha['2026-08-20']).toMatchObject({ monto: 4000, pedidos: 1 });
    // El día anterior a cada venta tiene que quedar en cero: si la clave se
    // corriera una jornada, este es el assert que se rompe.
    expect(porFecha['2026-08-17'].monto).toBe(0);
    expect(porFecha['2026-08-19'].monto).toBe(0);

    expect(total).toBe(16500);
    expect(max).toBe(12500);
  });

  it('normaliza los bigint de COUNT(*) a number', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { dia: '2026-08-20', monto: 4000, pedidos: 7n },
    ]);

    const { dias } = await service.getFacturacionPorDia(7, AHORA);
    const hoy = dias[dias.length - 1];

    expect(typeof hoy.pedidos).toBe('number');
    expect(hoy.pedidos).toBe(7);
  });

  it('rellena con 0 los días sin ventas en vez de omitirlos', async () => {
    const { dias, total, max } = await service.getFacturacionPorDia(7, AHORA);

    expect(dias).toHaveLength(7);
    expect(dias.every((d) => d.monto === 0 && d.pedidos === 0)).toBe(true);
    expect(total).toBe(0);
    // Math.max() sobre un array vacío da -Infinity: el 0 del final lo evita.
    expect(max).toBe(0);
  });

  it('tolera un SUM nulo sin devolver NaN', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { dia: '2026-08-20', monto: null, pedidos: 0n },
    ]);

    const { dias } = await service.getFacturacionPorDia(7, AHORA);

    expect(dias[dias.length - 1].monto).toBe(0);
  });
});
