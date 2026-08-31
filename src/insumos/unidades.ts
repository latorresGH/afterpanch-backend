/**
 * Unidades de medida aceptadas para un insumo.
 *
 * El form del panel ofrece las cuatro primeras (kg / g / l / u). Las tres que
 * siguen estan porque YA hay datos con esos valores y una lista cerrada sin
 * ellas dejaria esos insumos sin poder editarse: cualquier PATCH que reenviara
 * su propia unidad se comeria un 400.
 *
 * - `unidades`: es el valor de los 47 insumos que existen hoy.
 * - `un`: el default con el que se crean los Extras.
 * - `ml`: la contraparte de `l`, por simetria con `g`/`kg`.
 *
 * Pendiente (no en este paso): normalizar `unidades`/`un` a `u` con una
 * migracion de datos y recortar la lista a las cuatro del mockup. Se toca
 * texto que hoy se muestra tal cual en el POS y en la carta, asi que va
 * aparte.
 */
export const UNIDADES_MEDIDA = [
  'kg',
  'g',
  'l',
  'u',
  'ml',
  'un',
  'unidades',
] as const;

export type UnidadMedida = (typeof UNIDADES_MEDIDA)[number];

/** Mensaje unico para los tres DTOs que validan contra la lista. */
export const MENSAJE_UNIDAD_INVALIDA = `unidadMedida debe ser una de: ${UNIDADES_MEDIDA.join(', ')}`;
