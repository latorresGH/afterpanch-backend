import { Prisma } from '@prisma/client';

/**
 * Fragmentos SQL de la seccion de Extras.
 *
 * ⚠️ TODOS asumen que la tabla "Extra" esta aliaseada como `e` en la query que
 * los interpola, salvo `EXTRAS_EXPANDIDOS`, que asume `pd` para "PedidoDetalle".
 */

/** Estado derivado de un extra. Mismo vocabulario que el de un insumo. */
export type EstadoExtra = 'OK' | 'BAJO' | 'SIN_STOCK' | 'PAUSADO';

/**
 * Estado derivado de un extra, como expresion SQL.
 *
 * Mismo orden de CASE y mismo significado que `ESTADO_SQL` de
 * `insumos/stock.sql.ts`: "pausado" gana sobre cualquier nivel de stock (un
 * extra dado de baja no dispara alertas) y "sin stock" gana sobre "bajo".
 *
 * No se reusa aquel a proposito y no por descuido: aquel esta escrito contra
 * el alias `i` de "Insumo" y este contra el alias `e` de "Extra". Son dos
 * tablas distintas; lo que se comparte es el CRITERIO, y por eso este
 * comentario existe: si cambia alla, tiene que cambiar aca.
 */
export const ESTADO_EXTRA_SQL = Prisma.sql`
  CASE
    WHEN NOT e."activo"                    THEN 'PAUSADO'
    WHEN e."stockActual" <= 0              THEN 'SIN_STOCK'
    WHEN e."stockActual" < e."stockMinimo" THEN 'BAJO'
    ELSE 'OK'
  END
`;

/**
 * "Bajo minimo" como predicado, para los FILTER de los conteos.
 *
 * Incluye los que estan en cero: la pregunta que contesta es "hay que
 * reponerlo?", y no tener nada es el caso mas urgente, no uno distinto. Solo
 * mira activos, igual que `ESTADO_EXTRA_SQL`.
 */
export const BAJO_MINIMO_EXTRA_SQL = Prisma.sql`
  (e."activo" AND e."stockActual" < e."stockMinimo")
`;

/** Sin nada encima. Subconjunto de `BAJO_MINIMO_EXTRA_SQL`. */
export const SIN_STOCK_EXTRA_SQL = Prisma.sql`
  (e."activo" AND e."stockActual" <= 0)
`;

/**
 * Expande el JSONB de `PedidoDetalle.extras` a una fila por extra vendido.
 *
 * `extras` es `jsonb` y puede venir en null cuando la linea no lleva ninguno.
 * `jsonb_array_elements` sobre null no rompe (devuelve cero filas en un
 * LATERAL), pero sobre un jsonb que NO sea array tira error en ejecucion. El
 * CASE lo normaliza a array vacio antes de expandir, asi una fila mal formada
 * resta un dato en vez de tumbar la request entera.
 *
 * ⚠️ DUPLICADO CONOCIDO. `stats.service.ts` tiene este mismo fragmento como
 * const privada (`EXTRAS_EXPANDIDOS`). Unificarlos significa editar la seccion
 * de Estadisticas, que esta fuera del alcance de este cambio. Si divergen, las
 * dos pantallas cuentan distinto: quien toque uno tiene que tocar el otro.
 */
export const EXTRAS_EXPANDIDOS = Prisma.sql`
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(pd."extras") = 'array'
         THEN pd."extras"
         ELSE '[]'::jsonb
    END
  ) AS ex
`;

/**
 * Ventas de extras dentro de un rango, como CTE, agrupadas por extra.
 *
 * Se cuenta sobre pedidos ENTREGADOS, igual que Estadisticas: un pedido
 * cancelado no facturo nada.
 *
 * El flag `cobrado` ya viene resuelto en el JSON (la regla de
 * `Categoria.cantExtrasGratis` + `Extra.esPremium` aplicada al momento del
 * pedido), asi que aca no se recalcula ninguna regla de negocio: se cuenta.
 * Los `COALESCE` sobre el cast cubren una fila sin la clave: sin ellos el
 * FILTER la dejaria afuera de las dos ramas y el extra desapareceria del
 * conteo.
 */
export function cteVentasDeExtras(desde: Date, hasta: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT ex->>'id'                                                   AS id,
           COUNT(*)::int                                               AS unidades,
           COUNT(*) FILTER (
             WHERE NOT COALESCE((ex->>'cobrado')::boolean, false)
           )::int                                                      AS gratis,
           COUNT(*) FILTER (
             WHERE COALESCE((ex->>'cobrado')::boolean, false)
           )::int                                                      AS cobrados,
           COALESCE(
             SUM(COALESCE((ex->>'precio')::float8, 0)) FILTER (
               WHERE COALESCE((ex->>'cobrado')::boolean, false)
             ), 0
           )::float8                                                   AS recaudado
    FROM "PedidoDetalle" pd
    JOIN "Pedido" ped ON ped."id" = pd."pedidoId"
    ${EXTRAS_EXPANDIDOS}
    WHERE ped."estado" = 'ENTREGADO'
      AND ped."createdAt" >= ${desde}
      AND ped."createdAt" <= ${hasta}
    GROUP BY ex->>'id'
  `;
}
