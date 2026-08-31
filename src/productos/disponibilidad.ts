/**
 * Disponibilidad de un producto a partir de su receta y del stock de sus
 * insumos.
 *
 * Vive aca y no en cada pantalla porque hasta ahora la cuenta la hacia el
 * navegador: el menu publico se bajaba la receta completa y el stock de todos
 * los insumos solo para pintar el cartel de "Agotado". Con esto el server
 * manda el booleano ya resuelto y no hace falta exponer ni la receta ni el
 * stock a un visitante sin login.
 */

/** Lo minimo que necesita una linea de receta para entrar en la cuenta. */
export interface LineaDeReceta {
  cantidad: number;
  insumo: { stockActual: number } | null;
}

export interface Disponibilidad {
  /** Si alcanza el stock para armar al menos una unidad. */
  disponible: boolean;
  /**
   * Cuantas unidades se pueden armar con el stock actual. `null` cuando el
   * producto no tiene receta: no es "cero", es "no se lleva por stock".
   */
  unidadesPosibles: number | null;
}

export function disponibilidadDe(receta: LineaDeReceta[]): Disponibilidad {
  // Sin receta no hay nada que descontar (gaseosa de reventa, combo armado en
  // el momento): se vende siempre. Es el mismo criterio que ya usaba el front.
  if (!receta || receta.length === 0) {
    return { disponible: true, unidadesPosibles: null };
  }

  let minimo = Infinity;

  for (const linea of receta) {
    // Una linea sin insumo (dato viejo o borrado) no puede resolverse: se
    // asume que falta, que es el lado seguro.
    if (!linea.insumo) return { disponible: false, unidadesPosibles: 0 };

    // Cantidad <= 0 solo existe en filas anteriores a la validacion del DTO.
    // No limita nada, asi que no entra en el minimo en vez de dividir por cero.
    if (!(linea.cantidad > 0)) continue;

    minimo = Math.min(
      minimo,
      Math.floor(linea.insumo.stockActual / linea.cantidad),
    );
  }

  // Todas las lineas tenian cantidad invalida: queda como los sin receta.
  if (minimo === Infinity) return { disponible: true, unidadesPosibles: null };

  const unidadesPosibles = Math.max(0, minimo);
  return { disponible: unidadesPosibles > 0, unidadesPosibles };
}
