import { Prisma } from '@prisma/client';

/**
 * Los fragmentos SQL que definen "como esta un insumo", compartidos por las
 * pantallas que los necesitan.
 *
 * Viven aca y no dentro de `AdminInsumosService` porque dejaron de ser de una
 * sola pantalla: la seccion de Proveedores cuenta los mismos "bajo minimo" y
 * muestra la misma compra sugerida, y dos copias que se desincronizan son dos
 * pantallas contando cosas distintas. Es la razon por la que ya estaban
 * factorizados como constantes dentro de Insumos; lo unico que cambia es que
 * ahora el archivo es compartido.
 *
 * ⚠️ TODOS asumen que la tabla "Insumo" esta aliaseada como `i` en la query
 * que los interpola. Es la convencion de las dos secciones.
 */

/** Estado derivado de un insumo. Lo calcula Postgres, no el cliente. */
export type EstadoInsumo = 'OK' | 'BAJO' | 'SIN_STOCK' | 'PAUSADO';

/**
 * Estado derivado de un insumo, como expresion SQL.
 *
 * El orden de los CASE es el que manda: "pausado" gana sobre cualquier nivel
 * de stock (un insumo dado de baja no dispara alertas), y "sin stock" gana
 * sobre "bajo" (0 siempre es menor que el minimo, pero no es lo mismo estar
 * corto que no tener nada).
 */
export const ESTADO_SQL = Prisma.sql`
  CASE
    WHEN NOT i."activo"                    THEN 'PAUSADO'
    WHEN i."stockActual" <= 0              THEN 'SIN_STOCK'
    WHEN i."stockActual" < i."stockMinimo" THEN 'BAJO'
    ELSE 'OK'
  END
`;

/**
 * Compra sugerida: lo que falta para volver al DOBLE del minimo.
 *
 * El doble y no el minimo justo porque reponer hasta el umbral deja al insumo
 * disparando la alerta al dia siguiente. Es la misma cuenta que hace el
 * mockup, resuelta en el server para que el total del header y las filas no
 * puedan dar distinto.
 */
export const COMPRA_SUGERIDA_SQL = Prisma.sql`
  GREATEST(0, i."stockMinimo" * 2 - i."stockActual")
`;

/**
 * "Bajo minimo" como predicado, para los FILTER de los conteos.
 *
 * Incluye los que estan en cero: la pregunta que contesta es "hay que
 * comprarlo?", y no tener nada es el caso mas urgente de todos, no uno
 * distinto. Solo mira activos, igual que `ESTADO_SQL`: un insumo pausado no
 * esta bajo minimo, esta fuera de juego.
 */
export const BAJO_MINIMO_SQL = Prisma.sql`
  (i."activo" AND i."stockActual" < i."stockMinimo")
`;

/** Sin nada encima. Subconjunto de `BAJO_MINIMO_SQL`, no un estado paralelo. */
export const SIN_STOCK_SQL = Prisma.sql`
  (i."activo" AND i."stockActual" <= 0)
`;
