import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EstadoPedido, MetodoPago, TipoPedido } from '@prisma/client';

import { StatsService } from './stats.service';
import { PrismaService } from '../prisma/prisma.service';
import { CajaService } from '../caja/caja.service';
import { PedidosService } from '../pedidos/pedidos.service';

/**
 * 20/08/2026 a media tarde. Con `dias=7` la ventana va del 14 al 20, y el
 * período anterior del 7 al 13.
 */
const AHORA = new Date(2026, 7, 20, 15, 30, 0);

/**
 * Los `$queryRaw` de este service son seis y se distinguen por su SQL, así que
 * el mock rutea por contenido en vez de por orden de llamada: si mañana cambia
 * el orden del `Promise.all`, los tests no se dan vuelta solos.
 */
function routerQueryRaw(respuestas: Record<string, any[]>) {
  return jest.fn((strings: TemplateStringsArray | string[], ...valores: any[]) => {
    // Los fragmentos `Prisma.sql` reusables (el CROSS JOIN LATERAL de extras)
    // NO viajan en el template: llegan como valor interpolado. Si se mirara
    // solo `strings`, esas queries quedarían sin su parte más reconocible.
    const partes = Array.from(strings as string[]);
    const sql = partes
      .map((parte, i) => {
        const valor = valores[i];
        const fragmento =
          valor && typeof valor === 'object' && Array.isArray(valor.strings)
            ? valor.strings.join(' ')
            : '';
        return parte + fragmento;
      })
      .join(' ');

    const esMaridaje = sql.includes('pd."productoId" IN');
    const esJsonb = sql.includes('jsonb_array_elements');
    const esSalsas = sql.includes('_AderezoToPedidoDetalle');

    let clave: string;
    if (sql.includes('EXTRACT') && sql.includes('HOUR')) clave = 'franjas';
    else if (sql.includes('"CajaMovimiento"')) clave = 'mejorDia';
    else if (esSalsas && esMaridaje) clave = 'maridajeSalsas';
    else if (esSalsas) clave = 'salsas';
    else if (esJsonb && esMaridaje) clave = 'maridajeExtras';
    else if (esJsonb && sql.includes('GROUP BY')) clave = 'extrasItems';
    else if (esJsonb) clave = 'extrasTotales';
    else clave = 'desconocida';

    if (clave === 'desconocida') {
      throw new Error(`El mock no sabe rutear esta query:\n${sql}`);
    }

    return Promise.resolve(respuestas[clave] ?? []);
  });
}

describe('StatsService — GET /admin/estadisticas', () => {
  let service: StatsService;
  let prisma: any;
  let caja: any;
  let pedidos: any;
  let respuestas: Record<string, any[]>;

  const CAJA_VACIA = {
    cobrado: 0,
    entradas: 0,
    salidas: 0,
    balance: 0,
    ticketsCerrados: 0,
    ticketPromedio: 0,
  };

  beforeEach(async () => {
    respuestas = {
      franjas: [],
      mejorDia: [],
      maridajeSalsas: [],
      maridajeExtras: [],
      salsas: [],
      extrasItems: [],
      extrasTotales: [{ gratis: 0, cobrados: 0, recaudado: 0 }],
    };

    prisma = {
      $queryRaw: routerQueryRaw(respuestas),
      pedido: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { total: 0, costoEnvio: 0 },
          _count: { _all: 0 },
        }),
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      pedidoDetalle: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { cantidad: 0 } }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      producto: { findMany: jest.fn().mockResolvedValue([]) },
    };

    caja = {
      getResumenAgregado: jest.fn().mockResolvedValue({ ...CAJA_VACIA }),
    };
    pedidos = {
      getFacturacionPorRango: jest
        .fn()
        .mockResolvedValue({ dias: [], total: 0, max: 0 }),
      getPendienteCobro: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CajaService, useValue: caja },
        { provide: PedidosService, useValue: pedidos },
      ],
    }).compile();

    service = module.get(StatsService);
  });

  // ------------------------------------------------------------- el rango

  describe('resolución del rango', () => {
    it('sin parámetros toma los últimos 14 días, hoy incluido', async () => {
      const { rango } = await service.getEstadisticas({}, AHORA);

      expect(rango.desde).toBe('2026-08-07');
      expect(rango.hasta).toBe('2026-08-20');
      expect(rango.dias).toBe(14);
    });

    it('dias=7 acota la ventana y deja el período anterior contiguo', async () => {
      const { rango } = await service.getEstadisticas({ dias: 7 }, AHORA);

      expect(rango.desde).toBe('2026-08-14');
      expect(rango.hasta).toBe('2026-08-20');
      expect(rango.anterior).toEqual({
        desde: '2026-08-07',
        hasta: '2026-08-13',
      });
    });

    it('desde/hasta pisan a dias', async () => {
      const { rango } = await service.getEstadisticas(
        { desde: '2026-07-01', hasta: '2026-07-31', dias: 7 },
        AHORA,
      );

      expect(rango.desde).toBe('2026-07-01');
      expect(rango.hasta).toBe('2026-07-31');
      expect(rango.dias).toBe(31);
      expect(rango.anterior).toEqual({
        desde: '2026-05-31',
        hasta: '2026-06-30',
      });
    });

    it('con una sola fecha el rango se cierra sobre ese día', async () => {
      const { rango } = await service.getEstadisticas(
        { desde: '2026-07-04' },
        AHORA,
      );

      expect(rango).toMatchObject({
        desde: '2026-07-04',
        hasta: '2026-07-04',
        dias: 1,
      });
    });

    it('el rango invertido es 400, no un resultado vacío', async () => {
      await expect(
        service.getEstadisticas(
          { desde: '2026-08-20', hasta: '2026-08-01' },
          AHORA,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('una fecha con forma válida pero inexistente es 400', async () => {
      await expect(
        service.getEstadisticas({ desde: '2026-02-31' }, AHORA),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('el rango se pasa al SQL cubriendo el día entero', async () => {
      await service.getEstadisticas({ desde: '2026-08-10' }, AHORA);

      const { createdAt } = prisma.pedido.aggregate.mock.calls[0][0].where;
      expect(createdAt.gte.getHours()).toBe(0);
      expect(createdAt.gte.getMinutes()).toBe(0);
      // Sin el 23:59:59.999 se perdería todo lo vendido después de medianoche
      // del último día del rango.
      expect(createdAt.lte.getHours()).toBe(23);
      expect(createdAt.lte.getMinutes()).toBe(59);
      expect(createdAt.lte.getMilliseconds()).toBe(999);
    });

    it('informa la zona horaria con la que agrupó', async () => {
      const { rango } = await service.getEstadisticas({}, AHORA);
      expect(rango.zonaHoraria).toBe('America/Argentina/Buenos_Aires');
    });
  });

  // -------------------------------------------------------- facturación

  describe('facturación', () => {
    beforeEach(() => {
      prisma.pedido.aggregate
        .mockResolvedValueOnce({
          _sum: { total: 90000, costoEnvio: 10000 },
          _count: { _all: 10 },
        })
        .mockResolvedValueOnce({
          _sum: { total: 40000, costoEnvio: 10000 },
          _count: { _all: 5 },
        });
    });

    it('separa negocio de delivery y saca el ticket promedio', async () => {
      const { facturacion } = await service.getEstadisticas({ dias: 7 }, AHORA);

      expect(facturacion).toMatchObject({
        monto: 100000,
        negocio: 90000,
        delivery: 10000,
        pedidos: 10,
        ticketPromedio: 10000,
      });
    });

    it('calcula el delta contra el período anterior', async () => {
      const { facturacion } = await service.getEstadisticas({ dias: 7 }, AHORA);

      expect(facturacion.anterior.monto).toBe(50000);
      expect(facturacion.delta.monto).toBe(100); // 50k → 100k
      expect(facturacion.delta.pedidos).toBe(100); // 5 → 10
    });

    it('con período anterior en cero el delta es 0, no Infinity', async () => {
      prisma.pedido.aggregate.mockReset();
      prisma.pedido.aggregate
        .mockResolvedValueOnce({
          _sum: { total: 5000, costoEnvio: 0 },
          _count: { _all: 1 },
        })
        .mockResolvedValueOnce({
          _sum: { total: null, costoEnvio: null },
          _count: { _all: 0 },
        });

      const { facturacion } = await service.getEstadisticas({ dias: 7 }, AHORA);

      expect(facturacion.delta.monto).toBe(0);
      expect(Number.isFinite(facturacion.delta.monto)).toBe(true);
    });

    it('sin ventas no devuelve NaN en ningún lado', async () => {
      prisma.pedido.aggregate.mockReset();
      prisma.pedido.aggregate.mockResolvedValue({
        _sum: { total: null, costoEnvio: null },
        _count: { _all: 0 },
      });

      const { facturacion } = await service.getEstadisticas({}, AHORA);

      expect(facturacion.monto).toBe(0);
      expect(facturacion.ticketPromedio).toBe(0);
    });
  });

  // ------------------------------------------------------------- entrega

  describe('tasa de entrega', () => {
    it('mide sobre TODOS los pedidos del período, no sobre los entregados', async () => {
      prisma.pedido.groupBy.mockImplementation(({ by }: any) => {
        if (by[0] !== 'estado') return Promise.resolve([]);
        return Promise.resolve([
          {
            estado: EstadoPedido.ENTREGADO,
            _count: { _all: 8 },
            _sum: { total: 80000, costoEnvio: 0 },
          },
          {
            estado: EstadoPedido.CANCELADO,
            _count: { _all: 2 },
            _sum: { total: 20000, costoEnvio: 0 },
          },
        ]);
      });

      const { entrega } = await service.getEstadisticas({ dias: 7 }, AHORA);

      expect(entrega.pedidos).toBe(10);
      expect(entrega.entregados).toBe(8);
      // Si el denominador fueran los entregados esto daría 100.
      expect(entrega.tasa).toBe(80);
    });

    it('devuelve los siete estados aunque no tengan pedidos', async () => {
      const { entrega } = await service.getEstadisticas({}, AHORA);

      expect(entrega.porEstado).toHaveLength(
        Object.values(EstadoPedido).length,
      );
      expect(entrega.porEstado.every((e) => e.pedidos === 0)).toBe(true);
    });

    it('sin pedidos la tasa es 0, no NaN', async () => {
      const { entrega } = await service.getEstadisticas({}, AHORA);
      expect(entrega.tasa).toBe(0);
    });
  });

  // ------------------------------------------------ tipo y método de pago

  describe('cortes por tipo y método de pago', () => {
    it('devuelve los tres tipos siempre, con su share', async () => {
      prisma.pedido.groupBy.mockImplementation(({ by }: any) => {
        if (by[0] !== 'tipo') return Promise.resolve([]);
        return Promise.resolve([
          {
            tipo: TipoPedido.DELIVERY,
            _count: { _all: 6 },
            _sum: { total: 60000, costoEnvio: 15000 },
          },
          {
            tipo: TipoPedido.LOCAL,
            _count: { _all: 4 },
            _sum: { total: 25000, costoEnvio: 0 },
          },
        ]);
      });

      const { porTipo } = await service.getEstadisticas({ dias: 7 }, AHORA);

      expect(porTipo.map((t) => t.tipo)).toEqual(Object.values(TipoPedido));
      expect(porTipo.find((t) => t.tipo === TipoPedido.DELIVERY)).toMatchObject(
        { pedidos: 6, monto: 75000, share: 75 },
      );
      // RETIRO no vino del groupBy pero tiene que estar en cero.
      expect(porTipo.find((t) => t.tipo === TipoPedido.RETIRO)).toMatchObject({
        pedidos: 0,
        monto: 0,
        share: 0,
      });
    });

    it('devuelve los tres métodos de pago, sin un cuarto bucket', async () => {
      prisma.pedido.groupBy.mockImplementation(({ by }: any) => {
        if (by[0] !== 'metodoPago') return Promise.resolve([]);
        return Promise.resolve([
          {
            metodoPago: MetodoPago.EFECTIVO,
            _count: { _all: 5 },
            _sum: { total: 50000, costoEnvio: 0 },
          },
        ]);
      });

      const { porMetodoPago } = await service.getEstadisticas(
        { dias: 7 },
        AHORA,
      );

      expect(porMetodoPago.metodos.map((m) => m.metodoPago)).toEqual(
        Object.values(MetodoPago),
      );
    });

    it('los pedidos sin método no se pierden: van a sinRegistrar', async () => {
      prisma.pedido.groupBy.mockImplementation(({ by }: any) => {
        if (by[0] !== 'metodoPago') return Promise.resolve([]);
        return Promise.resolve([
          {
            metodoPago: MetodoPago.EFECTIVO,
            _count: { _all: 5 },
            _sum: { total: 50000, costoEnvio: 0 },
          },
          {
            metodoPago: null,
            _count: { _all: 3 },
            _sum: { total: 30000, costoEnvio: 0 },
          },
        ]);
      });

      const { porMetodoPago } = await service.getEstadisticas(
        { dias: 7 },
        AHORA,
      );

      expect(porMetodoPago.sinRegistrar).toEqual({ pedidos: 3, monto: 30000 });
      // Y no se cuela como un método más.
      expect(porMetodoPago.metodos).toHaveLength(3);
    });
  });

  // ---------------------------------------------------- franjas horarias

  describe('franjas horarias', () => {
    it('devuelve las 24 horas, no solo las que tuvieron ventas', async () => {
      respuestas.franjas.push({ hora: 21, pedidos: 12, monto: 90000 });

      const { franjasHorarias } = await service.getEstadisticas(
        { dias: 7 },
        AHORA,
      );

      expect(franjasHorarias.horas).toHaveLength(24);
      expect(franjasHorarias.horas[0]).toMatchObject({
        hora: 0,
        label: '00:00',
        pedidos: 0,
      });
      expect(franjasHorarias.horas[21]).toMatchObject({
        hora: 21,
        label: '21:00',
        pedidos: 12,
      });
    });

    it('la hora pico es la de más pedidos', async () => {
      respuestas.franjas.push(
        { hora: 20, pedidos: 5, monto: 1000 },
        { hora: 21, pedidos: 12, monto: 9000 },
        { hora: 22, pedidos: 9, monto: 4000 },
      );

      const { franjasHorarias } = await service.getEstadisticas(
        { dias: 7 },
        AHORA,
      );

      expect(franjasHorarias.pico).toMatchObject({ hora: 21, pedidos: 12 });
      expect(franjasHorarias.maxPedidos).toBe(12);
    });

    it('sin pedidos el pico es null, no la hora 0', async () => {
      const { franjasHorarias } = await service.getEstadisticas({}, AHORA);

      // Devolver la hora 0 se leería como "el pico fue a medianoche".
      expect(franjasHorarias.pico).toBeNull();
      expect(franjasHorarias.maxPedidos).toBe(0);
    });
  });

  // ------------------------------------------------- productos y maridaje

  describe('top productos y maridaje', () => {
    beforeEach(() => {
      prisma.pedidoDetalle.groupBy.mockResolvedValue([
        {
          productoId: 'p-mila',
          _sum: { cantidad: 40, subtotal: 616000 },
          _count: { _all: 30 },
        },
        {
          productoId: 'p-hamb',
          _sum: { cantidad: 20, subtotal: 256000 },
          _count: { _all: 20 },
        },
      ]);
      prisma.pedidoDetalle.aggregate.mockResolvedValue({
        _sum: { cantidad: 100 },
      });
      prisma.producto.findMany.mockResolvedValue([
        {
          id: 'p-mila',
          nombre: 'Milanesa napolitana',
          precio: 15400,
          imagenUrl: '/mila.jpg',
        },
        {
          id: 'p-hamb',
          nombre: 'Hamburguesa completa',
          precio: 12800,
          imagenUrl: null,
        },
      ]);
    });

    it('rankea y calcula el share sobre TODAS las unidades del período', async () => {
      const { topProductos } = await service.getEstadisticas(
        { dias: 7 },
        AHORA,
      );

      expect(topProductos[0]).toMatchObject({
        rank: 1,
        nombre: 'Milanesa napolitana',
        unidades: 40,
        facturado: 616000,
        // 40 de 100 unidades vendidas, no 40 de las 60 del top.
        share: 40,
      });
      expect(topProductos[1].rank).toBe(2);
    });

    it('el maridaje se mide sobre las líneas de ESE producto', async () => {
      respuestas.maridajeSalsas.push(
        { productoId: 'p-mila', id: 'a-mayo', nombre: 'Mayonesa', lineas: 21 },
        { productoId: 'p-mila', id: 'a-ket', nombre: 'Kétchup', lineas: 12 },
      );

      const { topProductos } = await service.getEstadisticas(
        { dias: 7 },
        AHORA,
      );

      // 21 de las 30 líneas de milanesa = 70%.
      expect(topProductos[0].salsas[0]).toMatchObject({
        nombre: 'Mayonesa',
        lineas: 21,
        pct: 70,
      });
      expect(topProductos[0].salsas[1].pct).toBe(40);
    });

    it('cada producto recibe solo su propio maridaje', async () => {
      respuestas.maridajeSalsas.push(
        { productoId: 'p-mila', id: 'a-mayo', nombre: 'Mayonesa', lineas: 21 },
        { productoId: 'p-hamb', id: 'a-ket', nombre: 'Kétchup', lineas: 16 },
      );

      const { topProductos } = await service.getEstadisticas(
        { dias: 7 },
        AHORA,
      );

      expect(topProductos[0].salsas.map((s) => s.nombre)).toEqual(['Mayonesa']);
      expect(topProductos[1].salsas.map((s) => s.nombre)).toEqual(['Kétchup']);
    });

    it('el extra usa el nombre actual, no el snapshot del JSON', async () => {
      respuestas.maridajeExtras.push({
        productoId: 'p-mila',
        id: 'e-ched',
        nombreSnapshot: 'Cheddar',
        nombreActual: 'Cheddar extra',
        lineas: 15,
      });

      const { topProductos } = await service.getEstadisticas(
        { dias: 7 },
        AHORA,
      );

      // Agrupa por id justamente para que un rename no parta la serie.
      expect(topProductos[0].extras[0]).toMatchObject({
        nombre: 'Cheddar extra',
        pct: 50,
      });
    });

    it('un extra borrado cae al nombre del snapshot en vez de romper', async () => {
      respuestas.maridajeExtras.push({
        productoId: 'p-mila',
        id: 'e-viejo',
        nombreSnapshot: 'Panceta',
        nombreActual: null,
        lineas: 3,
      });

      const { topProductos } = await service.getEstadisticas(
        { dias: 7 },
        AHORA,
      );

      expect(topProductos[0].extras[0].nombre).toBe('Panceta');
    });

    it('recorta el maridaje a 5 por producto', async () => {
      for (let i = 0; i < 9; i++) {
        respuestas.maridajeSalsas.push({
          productoId: 'p-mila',
          id: `a-${i}`,
          nombre: `Salsa ${i}`,
          lineas: 10 - i,
        });
      }

      const { topProductos } = await service.getEstadisticas(
        { dias: 7 },
        AHORA,
      );

      expect(topProductos[0].salsas).toHaveLength(5);
    });

    it('sin productos no dispara las queries de maridaje', async () => {
      prisma.pedidoDetalle.groupBy.mockResolvedValue([]);

      const { topProductos } = await service.getEstadisticas({}, AHORA);

      expect(topProductos).toEqual([]);
      // Un `IN ()` con la lista vacía es error de sintaxis en Postgres: el
      // guard tiene que cortar antes de llegar al SQL.
      const sqls = prisma.$queryRaw.mock.calls.map((c: any[]) =>
        (c[0] as string[]).join(' '),
      );
      expect(sqls.some((s: string) => s.includes('pd."productoId" IN'))).toBe(
        false,
      );
    });

    it('un producto borrado no rompe el ranking', async () => {
      prisma.producto.findMany.mockResolvedValue([]);

      const { topProductos } = await service.getEstadisticas(
        { dias: 7 },
        AHORA,
      );

      expect(topProductos[0].nombre).toBe('Producto eliminado');
      expect(topProductos[0].unidades).toBe(40);
    });
  });

  // ---------------------------------------------------- salsas y extras

  describe('salsas más pedidas', () => {
    it('calcula el % sobre los pedidos entregados del período', async () => {
      prisma.pedido.count.mockResolvedValue(50);
      respuestas.salsas.push(
        { id: 'a-mayo', nombre: 'Mayonesa', pedidos: 35 },
        { id: 'a-ket', nombre: 'Kétchup', pedidos: 29 },
      );

      const { salsas } = await service.getEstadisticas({ dias: 7 }, AHORA);

      expect(salsas[0]).toMatchObject({ nombre: 'Mayonesa', pct: 70 });
      expect(salsas[1]).toMatchObject({ nombre: 'Kétchup', pct: 58 });
    });

    it('no expone un total de sachets', async () => {
      prisma.pedido.count.mockResolvedValue(10);
      respuestas.salsas.push({ id: 'a-mayo', nombre: 'Mayonesa', pedidos: 7 });

      const { salsas } = await service.getEstadisticas({ dias: 7 }, AHORA);

      // El dato no existe (aderezosIds es un set sin cantidad): quedó afuera
      // a propósito, no se inventa.
      expect(salsas[0]).not.toHaveProperty('sachets');
      expect(salsas[0]).not.toHaveProperty('cantidad');
    });

    it('sin pedidos el % es 0, no NaN', async () => {
      respuestas.salsas.push({ id: 'a-mayo', nombre: 'Mayonesa', pedidos: 3 });

      const { salsas } = await service.getEstadisticas({}, AHORA);

      expect(salsas[0].pct).toBe(0);
    });
  });

  describe('extras gratis vs cobrado', () => {
    it('separa gratis de cobrados y suma lo recaudado', async () => {
      respuestas.extrasItems.push({
        id: 'e-papas',
        nombreSnapshot: 'Papitas',
        nombreActual: 'Papitas',
        categoria: 'TOPPINGS',
        gratis: 22,
        cobrados: 78,
        recaudado: 39000,
      });
      respuestas.extrasTotales = [
        { gratis: 40, cobrados: 110, recaudado: 55000 },
      ];

      const { extras } = await service.getEstadisticas({ dias: 7 }, AHORA);

      expect(extras.items[0]).toMatchObject({
        nombre: 'Papitas',
        categoria: 'TOPPINGS',
        gratis: 22,
        cobrados: 78,
        unidades: 100,
        recaudado: 39000,
        pctGratis: 22,
      });
    });

    it('los totales salen de su propia query, no de sumar el top', async () => {
      respuestas.extrasItems.push({
        id: 'e-papas',
        nombreSnapshot: 'Papitas',
        nombreActual: 'Papitas',
        categoria: 'TOPPINGS',
        gratis: 22,
        cobrados: 78,
        recaudado: 39000,
      });
      respuestas.extrasTotales = [
        { gratis: 40, cobrados: 110, recaudado: 55000 },
      ];

      const { extras } = await service.getEstadisticas({ dias: 7 }, AHORA);

      // El LIMIT del ranking recorta la cola: si el total se sumara sobre
      // `items` daría 39000 y estaría subreportando la plata.
      expect(extras.totales).toMatchObject({
        gratis: 40,
        cobrados: 110,
        unidades: 150,
        recaudado: 55000,
      });
    });

    it('sin extras no devuelve NaN', async () => {
      const { extras } = await service.getEstadisticas({}, AHORA);

      expect(extras.items).toEqual([]);
      expect(extras.totales).toMatchObject({
        gratis: 0,
        cobrados: 0,
        recaudado: 0,
        pctGratis: 0,
      });
    });
  });

  // ---------------------------------------------------- caja y conciliación

  describe('caja del período', () => {
    it('expone entradas, salidas, neta y margen', async () => {
      caja.getResumenAgregado.mockResolvedValue({
        ...CAJA_VACIA,
        entradas: 200000,
        salidas: 50000,
        balance: 150000,
        ticketsCerrados: 20,
        ticketPromedio: 10000,
      });

      const { caja: bloque } = await service.getEstadisticas(
        { dias: 7 },
        AHORA,
      );

      expect(bloque).toMatchObject({
        entradas: 200000,
        salidas: 50000,
        neta: 150000,
        margen: 75,
      });
    });

    it('el mejor día sale del rango pedido', async () => {
      respuestas.mejorDia.push({ dia: '2026-08-16', entradas: 87000 });

      const { caja: bloque } = await service.getEstadisticas(
        { dias: 7 },
        AHORA,
      );

      expect(bloque.mejorDia).toEqual({
        fecha: '2026-08-16',
        entradas: 87000,
      });
    });

    it('sin movimientos el mejor día es null', async () => {
      const { caja: bloque } = await service.getEstadisticas({}, AHORA);
      expect(bloque.mejorDia).toBeNull();
    });

    it('un día con entradas en cero no cuenta como mejor día', async () => {
      respuestas.mejorDia.push({ dia: '2026-08-16', entradas: 0 });

      const { caja: bloque } = await service.getEstadisticas(
        { dias: 7 },
        AHORA,
      );

      expect(bloque.mejorDia).toBeNull();
    });

    it('sin entradas el margen es 0, no NaN', async () => {
      const { caja: bloque } = await service.getEstadisticas({}, AHORA);
      expect(bloque.margen).toBe(0);
    });
  });

  describe('conciliación facturación vs caja', () => {
    it('expone los dos números y su diferencia', async () => {
      prisma.pedido.aggregate.mockResolvedValue({
        _sum: { total: 100000, costoEnvio: 20000 },
        _count: { _all: 12 },
      });
      caja.getResumenAgregado.mockResolvedValue({
        ...CAJA_VACIA,
        entradas: 95000,
      });
      pedidos.getPendienteCobro.mockResolvedValue(310000);

      const { conciliacion } = await service.getEstadisticas(
        { dias: 7 },
        AHORA,
      );

      expect(conciliacion).toEqual({
        facturado: 120000,
        cobrado: 95000,
        // Los dos criterios de fecha son distintos a propósito: la diferencia
        // es un dato, no un error a esconder.
        diferencia: 25000,
        pendienteCobroGlobal: 310000,
      });
    });
  });

  // ------------------------------------------------------------ reuso

  describe('reuso de los services de dominio', () => {
    it('la serie diaria y la caja las pide a sus dueños, con el mismo rango', async () => {
      await service.getEstadisticas({ dias: 7 }, AHORA);

      expect(pedidos.getFacturacionPorRango).toHaveBeenCalledTimes(1);
      expect(caja.getResumenAgregado).toHaveBeenCalledTimes(1);

      const [inicioSerie, finSerie] =
        pedidos.getFacturacionPorRango.mock.calls[0];
      const [inicioCaja, finCaja] = caja.getResumenAgregado.mock.calls[0];

      expect(inicioSerie.getTime()).toBe(inicioCaja.getTime());
      expect(finSerie.getTime()).toBe(finCaja.getTime());
    });

    it('no trae filas para reducir en memoria', async () => {
      await service.getEstadisticas({ dias: 7 }, AHORA);

      // El único findMany permitido es el de nombres del ranking, que está
      // acotado por el `take` del groupBy.
      expect(prisma.pedido.findMany).toBeUndefined();
      expect(prisma.pedidoDetalle.findMany).toBeUndefined();
    });
  });
});
