/**
 * Zona horaria del negocio. El proceso corre con
 * `process.env.TZ = 'America/Argentina/Buenos_Aires'` (ver main.ts), así que
 * `setHours` y compañía ya operan en hora local argentina. Se deja la
 * constante explícita para el SQL, donde no hay TZ de proceso que valga.
 */
export const ZONA_HORARIA_NEGOCIO = 'America/Argentina/Buenos_Aires';

/**
 * Límites del día calendario que contiene a `ahora`.
 *
 * El Home trabaja sobre "Hoy" (fecha calendario), sin concepto de turno ni
 * caja abierta/cerrada: no existe ese modelo en el schema.
 */
export function rangoDelDia(ahora: Date = new Date()): {
  inicio: Date;
  fin: Date;
} {
  return { inicio: inicioDelDia(ahora), fin: finDelDia(ahora) };
}

/** 00:00:00.000 local del día que contiene a `fecha`. */
export function inicioDelDia(fecha: Date): Date {
  const inicio = new Date(fecha);
  inicio.setHours(0, 0, 0, 0);
  return inicio;
}

/** 23:59:59.999 local del día que contiene a `fecha`. */
export function finDelDia(fecha: Date): Date {
  const fin = new Date(fecha);
  fin.setHours(23, 59, 59, 999);
  return fin;
}

/**
 * `'2026-08-01'` → medianoche local de ese día.
 *
 * A mano y no con `new Date(texto)`: el constructor interpreta un string de
 * fecha sola como UTC, así que en un server en UTC-3 `new Date('2026-08-01')`
 * cae el 31/07 a las 21:00 y el rango arranca un día antes de lo pedido.
 * Devuelve `null` si el texto no tiene la forma esperada.
 */
export function parseFechaLocal(texto: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto?.trim() ?? '');
  if (!m) return null;

  const [, año, mes, dia] = m;
  const fecha = new Date(Number(año), Number(mes) - 1, Number(dia), 0, 0, 0, 0);

  // `new Date(2026, 1, 31)` no explota: rebalsa al 3 de marzo. Comparar contra
  // lo que se pidió es la única forma de rechazar un 31/02.
  if (
    fecha.getFullYear() !== Number(año) ||
    fecha.getMonth() !== Number(mes) - 1 ||
    fecha.getDate() !== Number(dia)
  ) {
    return null;
  }

  return fecha;
}

/**
 * Cuántos días calendario abarca `[inicio, fin]`, con los dos extremos
 * incluidos. Se cuenta sobre las fechas, no sobre la diferencia en
 * milisegundos: así el resultado no depende de la hora de cada punta.
 */
export function diasEnRango(inicio: Date, fin: Date): number {
  const a = inicioDelDia(inicio).getTime();
  const b = inicioDelDia(fin).getTime();
  const MS_POR_DIA = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.round((b - a) / MS_POR_DIA) + 1);
}

/**
 * El rango de la misma longitud que termina justo antes de `inicio`, para
 * comparar un período contra el anterior. Se corre por días calendario y no
 * restando milisegundos para que el bloque anterior arranque a medianoche.
 */
export function rangoAnterior(
  inicio: Date,
  fin: Date,
): { inicio: Date; fin: Date } {
  const dias = diasEnRango(inicio, fin);

  const inicioAnterior = new Date(inicio);
  inicioAnterior.setDate(inicioAnterior.getDate() - dias);

  // Un milisegundo antes del arranque del período actual: los dos bloques son
  // contiguos y no se pisan ni dejan un hueco.
  const finAnterior = new Date(inicio.getTime() - 1);

  return { inicio: inicioDelDia(inicioAnterior), fin: finAnterior };
}

/**
 * Inicio del día de hace `dias - 1` jornadas, para una ventana que incluye hoy.
 * Con `dias = 7` devuelve el arranque de hace 6 días: 7 días contando el de hoy.
 */
export function inicioVentanaDias(
  dias: number,
  ahora: Date = new Date(),
): Date {
  const inicio = new Date(ahora);
  inicio.setDate(inicio.getDate() - (dias - 1));
  inicio.setHours(0, 0, 0, 0);
  return inicio;
}

/** `2026-08-20` en hora local, sin pasar por UTC (que correría el día). */
export function claveFecha(fecha: Date): string {
  const año = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${año}-${mes}-${dia}`;
}

/**
 * Identificador corto y estable de un pedido para mostrar en pantalla.
 * No hay número correlativo en el schema; el frontend ya venía usando
 * `id.slice(-6)`, así que se centraliza acá para que todas las pantallas
 * muestren lo mismo.
 */
export function codigoPedido(id: string): string {
  return id.slice(-6);
}
