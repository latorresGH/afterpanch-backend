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
  const inicio = new Date(ahora);
  inicio.setHours(0, 0, 0, 0);

  const fin = new Date(ahora);
  fin.setHours(23, 59, 59, 999);

  return { inicio, fin };
}

/**
 * Inicio del día de hace `dias - 1` jornadas, para una ventana que incluye hoy.
 * Con `dias = 7` devuelve el arranque de hace 6 días: 7 días contando el de hoy.
 */
export function inicioVentanaDias(dias: number, ahora: Date = new Date()): Date {
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
