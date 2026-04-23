/**
 * Normaliza una dirección para usar como clave de caché.
 * El objetivo es que variantes como "Av. Corrientes 1234" y
 * "avenida corrientes 1234" produzcan la misma key.
 *
 * Pasos en orden estricto:
 */
export function normalizeAddress(address: string): string {
  // 1. Pasar a minúsculas
  let normalized = address.toLowerCase();

  // 2. Quitar espacios al inicio y final
  normalized = normalized.trim();

  // 3. Quitar tildes: separar caracteres base de sus marcas diacríticas (NFD)
  //    y luego eliminar los combining marks (U+0300 a U+036F)
  normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 4. Quitar puntuación: puntos, comas, punto y coma, dos puntos
  normalized = normalized.replace(/[.,;:]/g, '');

  // 5. Quitar símbolos de grado/número: ° º
  normalized = normalized.replace(/[°º]/g, '');

  // 6. Separar letras pegadas a números y viceversa
  //    Ej: "corrientes1234" → "corrientes 1234"
  //    Ej: "1234a" → "1234 a"
  normalized = normalized.replace(/([a-z])(\d)/g, '$1 $2');
  normalized = normalized.replace(/(\d)([a-z])/g, '$1 $2');

  // 7. Colapsar espacios múltiples a uno solo
  normalized = normalized.replace(/\s+/g, ' ');

  // 8. Unificar prefijos de avenida/calle a "av"
  //    Matchea al inicio del string: av, avenida, avda, calle, c/, cl
  normalized = normalized.replace(
    /^(av|avenida|avda|calle|c\/|cl)\s+/i,
    'av ',
  );

  // 9. Quitar palabras "número/nº/nro" antes de la altura
  //    El paso 5 ya quitó el º, así que "Nº" quedó como "n" o "N" suelto
  //    antes de la altura. Regex: "n" seguido de espacio y dígitos.
  //    También cubre las formas completas "numero", "nro", etc.
  normalized = normalized.replace(/\s+n\s+(?=\d)/gi, ' ');
  normalized = normalized.replace(/\s+(numero|nro)\s*/gi, ' ');

  // 10. Trim final por si quedó espacio residual
  normalized = normalized.trim();

  return normalized;
}
