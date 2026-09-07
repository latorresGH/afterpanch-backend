import { Prisma } from '@prisma/client';

/**
 * Fragmentos SQL de la seccion de Salsas/Aderezos.
 *
 * ⚠️ TODOS asumen que la tabla "Aderezo" esta aliaseada como `a` en la query
 * que los interpola. Es la convencion de esta seccion, igual que `i` en
 * Insumos y `e` en Extras.
 */

/** Estado derivado de una salsa. Mismo vocabulario que insumos y extras. */
export type EstadoAderezo = 'OK' | 'BAJO' | 'SIN_STOCK' | 'PAUSADO';

/**
 * Estado derivado de una salsa, como expresion SQL.
 *
 * Mismo orden de CASE y mismo significado que `ESTADO_SQL` de
 * `insumos/stock.sql.ts`: "pausado" gana sobre cualquier nivel de stock (una
 * salsa dada de baja no dispara alertas) y "sin stock" gana sobre "bajo" (0
 * siempre es menor que el minimo, pero no es lo mismo estar corto que no tener
 * nada).
 *
 * No se reusa aquel a proposito y no por descuido: aquel esta escrito contra
 * el alias `i` de "Insumo" y este contra el alias `a` de "Aderezo". Son dos
 * tablas distintas; lo que se comparte es el CRITERIO, y por eso este
 * comentario existe: si cambia alla, tiene que cambiar aca.
 */
export const ESTADO_ADEREZO_SQL = Prisma.sql`
  CASE
    WHEN NOT a."activo"                    THEN 'PAUSADO'
    WHEN a."stockActual" <= 0              THEN 'SIN_STOCK'
    WHEN a."stockActual" < a."stockMinimo" THEN 'BAJO'
    ELSE 'OK'
  END
`;

/**
 * "Bajo minimo" como predicado, para los FILTER de los conteos.
 *
 * Incluye las que estan en cero: la pregunta que contesta es "hay que
 * reponerla?", y no tener nada es el caso mas urgente, no uno distinto. Solo
 * mira activas, igual que `ESTADO_ADEREZO_SQL`.
 */
export const BAJO_MINIMO_ADEREZO_SQL = Prisma.sql`
  (a."activo" AND a."stockActual" < a."stockMinimo")
`;

/** Sin nada encima. Subconjunto de `BAJO_MINIMO_ADEREZO_SQL`. */
export const SIN_STOCK_ADEREZO_SQL = Prisma.sql`
  (a."activo" AND a."stockActual" <= 0)
`;

/**
 * Los dos tipos de movimiento que mueven la aguja del consumo.
 *
 * Copiado a proposito de `admin-insumos.service.ts` (`TIPOS_DE_CONSUMO`), con
 * el mismo criterio: `AJUSTE_MANUAL` queda afuera porque reponer una compra o
 * corregir un recuento no es consumir.
 */
const TIPOS_DE_CONSUMO = Prisma.sql`('DESCUENTO_PEDIDO', 'REPOSICION')`;

/**
 * Consumo por salsa dentro de una ventana, como CTE.
 *
 * Mismo calculo que `AdminInsumosService.cteConsumo`, apuntado a `aderezoId`
 * en vez de `insumoId`. NETO, no bruto: se suman los DESCUENTO_PEDIDO y se les
 * restan las REPOSICION. El unico lugar que escribe REPOSICION es la
 * cancelacion de un pedido (`PedidosService.cancelar`), asi que netearlas es
 * lo correcto: la salsa de un pedido cancelado volvio al deposito y nunca se
 * consumio.
 *
 * `cantidad` ya viene firmada en la tabla (negativa si se descontó), asi que
 * el signo sale de invertir la suma y no de un ABS que lo asuma.
 *
 * OJO: una salsa sin movimientos NO aparece en este CTE. El LEFT JOIN la deja
 * con `consumido = 0`, y de ahi sale que su "aguante en dias" sea `null` y no
 * infinito: no es que dure para siempre, es que no hay con que estimarlo.
 */
export function cteConsumoDeAderezos(desde: Date, hasta: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT "aderezoId"            AS id,
           SUM(-"cantidad")::float8 AS consumido,
           COUNT(*)::int            AS movimientos
    FROM "StockMovimiento"
    WHERE "aderezoId" IS NOT NULL
      AND "tipo" IN ${TIPOS_DE_CONSUMO}
      AND "createdAt" >= ${desde}
      AND "createdAt" <= ${hasta}
    GROUP BY "aderezoId"
  `;
}

/**
 * Las combinaciones (salsa, categoria) donde la salsa SE OFRECE.
 *
 * Es la definicion canonica de "ofrecida", la misma que usa el backfill de
 * 20260831000000 y la que valida `AdminAderezosService`:
 *   - `esGlobal = true`  -> TODAS las categorias.
 *   - `esGlobal = false` -> las de "AderezoCategoria".
 *
 * Sin filtrar por `Categoria.activo`: el descuento al vender busca por el
 * categoriaId del producto sin mirar si la categoria esta activa, asi que una
 * inactiva con productos igual caeria al default de `getAderezoConsumo`.
 */
export const OFRECIDAS_SQL = Prisma.sql`
  SELECT a2."id" AS "aderezoId", c2."id" AS "categoriaId"
  FROM "Aderezo" a2
  CROSS JOIN "Categoria" c2
  WHERE a2."esGlobal" = true

  UNION

  SELECT ac."aderezoId", ac."categoriaId"
  FROM "AderezoCategoria" ac
`;
