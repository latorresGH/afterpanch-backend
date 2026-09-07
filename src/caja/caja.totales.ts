import { TipoMovimientoCaja } from '@prisma/client';

/**
 * LA definicion de los totales de caja. Una sola, para todos.
 *
 * Antes habia dos calculos paralelos que no coincidian:
 *
 *   - `obtenerResumenCaja` (lo que ven las pantallas de caja) hacia
 *     `findMany` + `reduce` en JS, sumaba `montoTotal` a "salidas" Y ademas
 *     `gananciaNegocio` (que para una SALIDA se guardaba en negativo) a
 *     "negocio". O sea: un gasto se restaba DOS VECES, en dos indicadores
 *     distintos de la misma pantalla.
 *
 *   - `getResumenAgregado` (lo que ve el Home y el panel de stats) hacia
 *     `aggregate` en Postgres mirando solo `montoTotal`, y calculaba
 *     `balance = entradas - salidas`.
 *
 * Con los mismos movimientos, las dos pantallas mostraban balances distintos.
 * Y un movimiento AJUSTE no aparecia en ninguno de los dos lados
 * (entradas/salidas solo miraban ENTRADA y SALIDA) pero igual movia el total
 * de "negocio", siempre en positivo: plata que se corregia para abajo subia
 * el numero.
 *
 * Ahora las dos entran por aca. Este modulo no habla con la base a proposito:
 * es aritmetica pura, asi que se puede testear entera sin levantar Postgres, y
 * sirve igual para el camino que ya tiene las filas en memoria
 * (`agruparMovimientos`) que para el que las pide agregadas a la base.
 */

/** Tipos de movimiento que llevan el signo adentro del `tipo`. */
const SALIDA = TipoMovimientoCaja.SALIDA;
const ENTRADA = TipoMovimientoCaja.ENTRADA;

/**
 * Cuanto mueve la caja un movimiento, con signo. Es la unica regla de signos
 * del sistema:
 *
 *   ENTRADA  → suma, siempre.
 *   SALIDA   → resta, siempre (se guarda con `montoTotal` positivo).
 *   AJUSTE   → lo que diga su propio `montoTotal`, que PUEDE ser negativo.
 *              Un ajuste es una correccion, y las correcciones van para los
 *              dos lados.
 *
 * No se le aplica `Math.abs` a nada: si una fila vieja quedo guardada rara
 * (una SALIDA con monto negativo, por ejemplo), se lee tal cual esta y se ve,
 * en vez de "corregirla" en silencio y esconder el problema.
 */
export function impactoDe(tipo: TipoMovimientoCaja, montoTotal: number): number {
  return tipo === SALIDA ? -montoTotal : montoTotal;
}

/**
 * Un grupo de movimientos que comparten tipo, signo y origen.
 *
 * Se agrupa por esas tres cosas y no solo por `tipo` porque hacen falta las
 * tres para derivar los totales sin volver a mirar fila por fila:
 * el signo separa un AJUSTE que suma de uno que resta (si se sumaran juntos,
 * un +1000 y un -1000 se cancelarian y las dos puntas desaparecerian del
 * resumen), y `dePedido` separa una venta cobrada de una entrada manual.
 */
export interface GrupoMovimientos {
  tipo: TipoMovimientoCaja;
  /** `montoTotal >= 0`. Todas las filas del grupo tienen el mismo signo. */
  positivo: boolean;
  /** `pedidoId IS NOT NULL`: el movimiento es el cobro de una venta. */
  dePedido: boolean;
  filas: number;
  monto: number;
  negocio: number;
  repartidor: number;
}

export interface TotalesCaja {
  /** Todo lo que sumo a la caja en el periodo (incluye ajustes positivos). */
  entradas: number;
  /** Todo lo que resto, como magnitud positiva (incluye ajustes negativos). */
  salidas: number;
  /** `entradas - salidas`. LA definicion de balance del sistema. */
  balance: number;
  /**
   * Solo ventas cobradas: ENTRADA con pedido detras. Es un subconjunto de
   * `entradas`, no un sinonimo — un fondo fijo o un ajuste positivo entran a
   * la caja pero no son facturacion.
   */
  cobrado: number;
  /** Cuantas ventas se cobraron. Denominador honesto de `ticketPromedio`. */
  ticketsCerrados: number;
  ticketPromedio: number;
  /**
   * Reparto de lo cobrado entre el negocio y el repartidor. Se suma SOLO
   * sobre ENTRADA: en un gasto manual estos dos campos no significan nada, y
   * de hecho eran los que causaban la doble resta.
   */
  gananciaNegocio: number;
  gananciaRepartidor: number;
}

/** Los montos son pesos: se limpia el polvo de coma flotante de las sumas. */
function pesos(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Deriva todos los totales a partir de los grupos. Es la unica implementacion
 * de la aritmetica de caja del sistema; `getResumenAgregado` y
 * `obtenerResumenCaja` no hacen mas que llamar a esto con distinto origen.
 */
export function derivarTotales(grupos: GrupoMovimientos[]): TotalesCaja {
  let entradas = 0;
  let salidas = 0;
  let cobrado = 0;
  let ticketsCerrados = 0;
  let gananciaNegocio = 0;
  let gananciaRepartidor = 0;

  for (const g of grupos) {
    const impacto = impactoDe(g.tipo, g.monto);

    // Cada grupo cae de un solo lado: la separacion por signo garantiza que
    // adentro del grupo no se mezclen movimientos que suman con los que restan.
    if (impacto > 0) entradas += impacto;
    else if (impacto < 0) salidas += -impacto;

    if (g.tipo === ENTRADA) {
      gananciaNegocio += g.negocio;
      gananciaRepartidor += g.repartidor;

      if (g.dePedido) {
        cobrado += g.monto;
        ticketsCerrados += g.filas;
      }
    }
  }

  entradas = pesos(entradas);
  salidas = pesos(salidas);
  cobrado = pesos(cobrado);

  return {
    entradas,
    salidas,
    balance: pesos(entradas - salidas),
    cobrado,
    ticketsCerrados,
    ticketPromedio: ticketsCerrados > 0 ? Math.round(cobrado / ticketsCerrados) : 0,
    gananciaNegocio: pesos(gananciaNegocio),
    gananciaRepartidor: pesos(gananciaRepartidor),
  };
}

/** La forma minima de movimiento que hace falta para agrupar. */
type MovimientoAgrupable = {
  tipo: TipoMovimientoCaja;
  montoTotal: number;
  gananciaNegocio: number;
  gananciaRepartidor: number;
  pedidoId?: string | null;
};

/**
 * Agrupa movimientos que YA estan en memoria, para que el camino que de todas
 * formas necesita la lista completa (`/caja/resumen`, que devuelve tambien los
 * movimientos) no tenga que pagar una segunda consulta solo para totalizar.
 *
 * El resultado entra al mismo `derivarTotales` que el agregado de Postgres:
 * mismo numero por los dos caminos, por construccion.
 */
export function agruparMovimientos(
  movimientos: MovimientoAgrupable[],
): GrupoMovimientos[] {
  const grupos = new Map<string, GrupoMovimientos>();

  for (const m of movimientos) {
    const positivo = m.montoTotal >= 0;
    const dePedido = m.pedidoId != null;
    const clave = `${m.tipo}|${positivo}|${dePedido}`;

    let g = grupos.get(clave);
    if (!g) {
      g = {
        tipo: m.tipo,
        positivo,
        dePedido,
        filas: 0,
        monto: 0,
        negocio: 0,
        repartidor: 0,
      };
      grupos.set(clave, g);
    }

    g.filas += 1;
    g.monto += m.montoTotal;
    g.negocio += m.gananciaNegocio;
    g.repartidor += m.gananciaRepartidor;
  }

  return [...grupos.values()];
}
