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

/**
 * A que hora "empieza el dia" para la caja.
 *
 * El local cierra despues de medianoche: un pedido cobrado a la 01:40 del
 * domingo es plata del sabado a la noche, no del domingo. Cortar a medianoche
 * partiria cada noche en dos dias y dejaria el arranque de cada jornada con
 * las ventas de la anterior encima.
 *
 * 02:30 es el corte acordado. No sale de `Configuracion` a proposito: no es
 * una preferencia por negocio, es la definicion de "hoy" que usa toda la
 * seccion Caja, y tenerla en un solo lugar es lo que hace que el filtro, el
 * resumen y el historial hablen del mismo periodo.
 *
 * OJO: esto NO es un turno. No hay apertura ni cierre de caja en el sistema
 * (no existe el modelo); es un corte horario para agrupar, nada mas.
 */
export const CORTE_DIA_COMERCIAL = { hora: 2, minuto: 30 } as const;

/**
 * El 02:30 que abre el dia comercial que contiene a `ahora`.
 *
 * A las 23:00 del lunes devuelve el lunes 02:30. A la 01:00 del martes
 * devuelve *tambien* el lunes 02:30, porque esa hora todavia es parte de la
 * noche del lunes.
 */
export function inicioDiaComercial(ahora: Date = new Date()): Date {
  const inicio = new Date(ahora);
  inicio.setHours(CORTE_DIA_COMERCIAL.hora, CORTE_DIA_COMERCIAL.minuto, 0, 0);

  // Antes del corte todavia estamos en la jornada que arranco ayer.
  if (ahora.getTime() < inicio.getTime()) {
    inicio.setDate(inicio.getDate() - 1);
  }

  return inicio;
}

/**
 * Los dos extremos de un dia comercial, con `desplazamiento` en jornadas
 * hacia atras: 0 es el dia en curso, 1 el anterior.
 *
 * El fin es un milisegundo antes del corte siguiente, no el corte mismo: los
 * dias comerciales quedan contiguos y no se pisan ni dejan un hueco, asi que
 * un movimiento cae en exactamente uno. Se avanza con `setDate` y no sumando
 * 24hs para que un cambio de horario de verano no corra el corte.
 */
export function rangoDiaComercial(
  ahora: Date = new Date(),
  desplazamiento = 0,
): { inicio: Date; fin: Date } {
  const inicio = inicioDiaComercial(ahora);
  inicio.setDate(inicio.getDate() - desplazamiento);

  const siguiente = new Date(inicio);
  siguiente.setDate(siguiente.getDate() + 1);

  return { inicio, fin: new Date(siguiente.getTime() - 1) };
}

/** Los periodos que entiende la seccion Caja. */
export const PERIODOS_CAJA = ['HOY', 'AYER'] as const;
export type PeriodoCaja = (typeof PERIODOS_CAJA)[number];

export function esPeriodoCaja(valor: unknown): valor is PeriodoCaja {
  return (
    typeof valor === 'string' &&
    (PERIODOS_CAJA as readonly string[]).includes(valor.toUpperCase())
  );
}

/**
 * `HOY` / `AYER` a un rango concreto, con el corte de las 02:30.
 *
 * Es la unica traduccion de periodo a fechas del sistema: el frontend manda el
 * nombre del periodo y no las fechas, para que el corte no quede escrito en
 * dos lugares que despues se desincronizan.
 */
export function rangoPeriodoCaja(
  periodo: PeriodoCaja,
  ahora: Date = new Date(),
): { inicio: Date; fin: Date } {
  return rangoDiaComercial(ahora, periodo === 'AYER' ? 1 : 0);
}
