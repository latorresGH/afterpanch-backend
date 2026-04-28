/**
 * Normaliza un número de teléfono para WhatsApp
 * Reglas:
 * - Elimina espacios, guiones, paréntesis, puntos
 * - Si empieza con 0, lo reemplaza por +549
 * - Si no tiene +, agrega +549 al principio
 * - Si ya tiene +54, asegura el 9
 */
export function normalizarTelefono(numero: string | null | undefined): string | null {
  if (!numero) return null;

  let limpio = numero
    .replace(/\s/g, '')
    .replace(/-/g, '')
    .replace(/\(/g, '')
    .replace(/\)/g, '')
    .replace(/\./g, '')
    .trim();

  if (limpio.startsWith('0')) {
    limpio = '+549' + limpio.slice(1);
  }

  if (!limpio.startsWith('+')) {
    limpio = '+549' + limpio;
  }

  if (limpio.startsWith('+54') && !limpio.startsWith('+549')) {
    limpio = '+549' + limpio.slice(3);
  }

  return limpio;
}
