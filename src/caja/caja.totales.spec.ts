import { TipoMovimientoCaja } from '@prisma/client';
import {
  agruparMovimientos,
  derivarTotales,
  impactoDe,
} from './caja.totales';

const { ENTRADA, SALIDA, AJUSTE } = TipoMovimientoCaja;

/** Un movimiento con la forma minima que necesita `agruparMovimientos`. */
const mov = (
  tipo: TipoMovimientoCaja,
  montoTotal: number,
  extra: { negocio?: number; repartidor?: number; pedidoId?: string | null } = {},
) => ({
  tipo,
  montoTotal,
  gananciaNegocio: extra.negocio ?? 0,
  gananciaRepartidor: extra.repartidor ?? 0,
  pedidoId: extra.pedidoId ?? null,
});

/** El cobro de un pedido, como lo escribe `registrarPagoPedido`. */
const cobro = (id: string, productos: number, envio: number) =>
  mov(ENTRADA, productos + envio, {
    negocio: productos,
    repartidor: envio,
    pedidoId: id,
  });

const totalesDe = (movs: Parameters<typeof agruparMovimientos>[0]) =>
  derivarTotales(agruparMovimientos(movs));

describe('impactoDe — la única regla de signos del sistema', () => {
  it('ENTRADA suma', () => {
    expect(impactoDe(ENTRADA, 1000)).toBe(1000);
  });

  it('SALIDA resta, aunque se guarde con monto positivo', () => {
    expect(impactoDe(SALIDA, 1000)).toBe(-1000);
  });

  it('AJUSTE respeta su propio signo, para los dos lados', () => {
    expect(impactoDe(AJUSTE, 500)).toBe(500);
    expect(impactoDe(AJUSTE, -500)).toBe(-500);
  });
});

describe('derivarTotales — balance unificado', () => {
  it('caja vacía da todo en cero, sin NaN ni división por cero', () => {
    expect(totalesDe([])).toEqual({
      entradas: 0,
      salidas: 0,
      balance: 0,
      cobrado: 0,
      ticketsCerrados: 0,
      ticketPromedio: 0,
      gananciaNegocio: 0,
      gananciaRepartidor: 0,
    });
  });

  describe('BUG: un gasto se restaba dos veces', () => {
    // Antes: `registrarMovimientoManual` guardaba gananciaNegocio = -monto en
    // las SALIDA, y `obtenerResumenCaja` sumaba montoTotal a "salidas" Y
    // gananciaNegocio a "negocio". El mismo gasto pegaba en los dos lugares.
    it('la SALIDA resta del balance UNA sola vez', () => {
      const t = totalesDe([cobro('p1', 10000, 2000), mov(SALIDA, 5000)]);

      expect(t.entradas).toBe(12000);
      expect(t.salidas).toBe(5000);
      expect(t.balance).toBe(7000);
    });

    it('la SALIDA no toca la ganancia del negocio: no es un reparto de venta', () => {
      const t = totalesDe([cobro('p1', 10000, 2000), mov(SALIDA, 5000)]);

      // Los 10000 de productos, enteros. El gasto vive en `salidas`.
      expect(t.gananciaNegocio).toBe(10000);
      expect(t.gananciaRepartidor).toBe(2000);
    });

    it('ignora la ganancia negativa que dejaron las filas viejas', () => {
      // Una SALIDA escrita por el código anterior: montoTotal 5000 y
      // gananciaNegocio -5000. El -5000 ya no se lee.
      const t = totalesDe([
        cobro('p1', 10000, 2000),
        mov(SALIDA, 5000, { negocio: -5000 }),
      ]);

      expect(t.gananciaNegocio).toBe(10000);
      expect(t.balance).toBe(7000);
    });
  });

  describe('BUG: el AJUSTE fantasma', () => {
    // Antes: entradas/salidas solo miraban ENTRADA y SALIDA, así que un AJUSTE
    // no aparecía en ninguno de los dos — pero sí movía gananciaNegocio, y
    // siempre en positivo.
    it('un ajuste positivo entra por "entradas" y sube el balance', () => {
      const t = totalesDe([mov(AJUSTE, 1500)]);

      expect(t.entradas).toBe(1500);
      expect(t.salidas).toBe(0);
      expect(t.balance).toBe(1500);
    });

    it('un ajuste NEGATIVO sale por "salidas" y BAJA el balance', () => {
      const t = totalesDe([mov(AJUSTE, -1500)]);

      expect(t.entradas).toBe(0);
      expect(t.salidas).toBe(1500);
      expect(t.balance).toBe(-1500);
    });

    it('un ajuste no cuenta como venta ni como ganancia del negocio', () => {
      const t = totalesDe([cobro('p1', 10000, 0), mov(AJUSTE, 1500)]);

      expect(t.cobrado).toBe(10000);
      expect(t.ticketsCerrados).toBe(1);
      expect(t.gananciaNegocio).toBe(10000);
    });

    it('dos ajustes opuestos NO se cancelan antes de llegar al resumen', () => {
      // Si se agrupara solo por tipo, +1000 y -1000 sumarían 0 y las dos
      // puntas desaparecerían del resumen. Se ven las dos.
      const t = totalesDe([mov(AJUSTE, 1000), mov(AJUSTE, -1000)]);

      expect(t.entradas).toBe(1000);
      expect(t.salidas).toBe(1000);
      expect(t.balance).toBe(0);
    });
  });

  describe('la identidad que tiene que cerrar siempre', () => {
    const escenario = [
      cobro('p1', 22000, 2800),
      cobro('p2', 19000, 2800),
      cobro('p3', 31500, 0),
      mov(SALIDA, 11200, { negocio: -11200 }), // pago a repartidor (fila vieja)
      mov(SALIDA, 42600), // insumos
      mov(AJUSTE, -3000), // faltante de arqueo
      mov(AJUSTE, 500), // sobrante
      mov(ENTRADA, 40000), // fondo fijo, sin pedido detrás
    ];

    it('balance === entradas - salidas', () => {
      const t = totalesDe(escenario);

      expect(t.balance).toBe(t.entradas - t.salidas);
    });

    it('balance === la suma de los impactos individuales', () => {
      const t = totalesDe(escenario);
      const aMano = escenario.reduce(
        (acc, m) => acc + impactoDe(m.tipo, m.montoTotal),
        0,
      );

      expect(t.balance).toBe(aMano);
    });

    it('`cobrado` son las ventas, `entradas` es todo lo que entró', () => {
      const t = totalesDe(escenario);

      // 24800 + 21800 + 31500, sin el fondo fijo ni el ajuste positivo.
      expect(t.cobrado).toBe(78100);
      expect(t.ticketsCerrados).toBe(3);
      // Lo de arriba + 40000 de fondo fijo + 500 de ajuste.
      expect(t.entradas).toBe(118600);
    });

    it('el ticket promedio se divide por ventas, no por movimientos', () => {
      const t = totalesDe(escenario);

      expect(t.ticketPromedio).toBe(Math.round(78100 / 3));
    });
  });

  it('no deja polvo de coma flotante en los totales', () => {
    const t = totalesDe([
      mov(ENTRADA, 0.1, { pedidoId: 'p1' }),
      mov(ENTRADA, 0.2, { pedidoId: 'p2' }),
    ]);

    expect(t.entradas).toBe(0.3);
    expect(t.balance).toBe(0.3);
  });
});

describe('los dos caminos dan el mismo número', () => {
  // `obtenerResumenCaja` agrupa filas que ya tiene en memoria;
  // `getResumenAgregado` recibe los grupos ya sumados por Postgres. Los dos
  // terminan en `derivarTotales`, así que tienen que coincidir exactamente.
  it('agrupar en JS y agrupar en SQL convergen', () => {
    const movimientos = [
      cobro('p1', 22000, 2800),
      cobro('p2', 19000, 2800),
      mov(SALIDA, 42600),
      mov(AJUSTE, -3000),
    ];

    const porMemoria = derivarTotales(agruparMovimientos(movimientos));

    // Lo que devolvería el GROUP BY (tipo, signo, origen) de Postgres.
    const porBase = derivarTotales([
      {
        tipo: ENTRADA,
        positivo: true,
        dePedido: true,
        filas: 2,
        monto: 46600,
        negocio: 41000,
        repartidor: 5600,
      },
      {
        tipo: SALIDA,
        positivo: true,
        dePedido: false,
        filas: 1,
        monto: 42600,
        negocio: 0,
        repartidor: 0,
      },
      {
        tipo: AJUSTE,
        positivo: false,
        dePedido: false,
        filas: 1,
        monto: -3000,
        negocio: 0,
        repartidor: 0,
      },
    ]);

    expect(porMemoria).toEqual(porBase);
    expect(porMemoria.balance).toBe(1000);
  });
});
