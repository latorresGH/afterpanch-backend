import {
  esPeriodoCaja,
  finDelDia,
  inicioDelDia,
  parseFechaLocal,
  rangoPeriodoCaja,
  type PeriodoCaja,
} from '../common/helpers/fecha.helper';

/**
 * De lo que llega por la URL al rango concreto que consultan `/caja/resumen` y
 * `/caja/historial`.
 *
 * Hay dos formas de pedir un periodo y una sola de resolverlo:
 *
 *   ?periodo=HOY|AYER          el dia comercial, con el corte de las 02:30.
 *                              Lo usa el filtro de la pantalla.
 *   ?fechaInicio=&fechaFin=    un rango a mano, por dia calendario. Lo usa el
 *                              selector de fechas del admin.
 *
 * `periodo` gana si viene: es mas especifico y es lo que manda el filtro.
 *
 * El corte de las 02:30 NO viaja al frontend. El cliente manda el nombre del
 * periodo y el backend lo traduce, para que la definicion de "hoy" viva en un
 * solo lugar en vez de en dos que se desincronizan.
 */
export interface QueryRangoCaja {
  periodo?: string;
  fechaInicio?: string;
  fechaFin?: string;
}

export interface RangoResuelto {
  inicio?: Date;
  fin?: Date;
  /** Que periodo se aplico, para que la respuesta lo confirme. */
  periodo: PeriodoCaja | 'RANGO' | 'TODO';
}

/**
 * Un limite del rango a partir del texto de la query.
 *
 * Acepta las dos formas que ya circulan:
 *   - `2026-09-07` (dia calendario) → se expande al arranque o al final de ese
 *     dia LOCAL. Se parsea a mano con `parseFechaLocal` y no con `new Date`,
 *     que interpreta una fecha sola como UTC: en un server en UTC-3,
 *     `new Date('2026-09-07')` cae el 06 a las 21:00 y el rango arranca un dia
 *     antes de lo que se pidio.
 *   - un ISO completo con hora → se toma tal cual, es un instante exacto.
 *
 * Devuelve `undefined` si el texto no sirve, que es lo mismo que no filtrar por
 * esa punta: un parametro escrito a mano no tiene por que voltear la pantalla.
 */
export function parseLimite(
  texto: string | undefined,
  extremo: 'inicio' | 'fin',
): Date | undefined {
  if (!texto?.trim()) return undefined;

  const soloFecha = parseFechaLocal(texto);
  if (soloFecha) {
    return extremo === 'inicio' ? inicioDelDia(soloFecha) : finDelDia(soloFecha);
  }

  // Solo un ISO con hora. El `new Date` pelado NO sirve de fallback: V8 adivina
  // demasiado y acepta cosas que este mismo modulo rechaza dos lineas mas
  // arriba —`new Date('2026-02-31')` rueda al 3 de marzo, `new Date('07-09-2026')`
  // lo lee como 9 de julio—, asi que un filtro mal escrito terminaria
  // devolviendo un rango silenciosamente equivocado en vez de ignorarse.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(texto.trim())) return undefined;

  const instante = new Date(texto);
  if (Number.isNaN(instante.getTime())) return undefined;

  // `new Date('2026-02-31T10:00:00Z')` tambien rebalsa: se valida la parte de
  // fecha por separado, con el mismo criterio estricto.
  return parseFechaLocal(texto.trim().slice(0, 10)) ? instante : undefined;
}

export function resolverRangoCaja(
  query: QueryRangoCaja,
  ahora: Date = new Date(),
): RangoResuelto {
  if (esPeriodoCaja(query.periodo)) {
    const periodo = query.periodo.toUpperCase() as PeriodoCaja;
    return { ...rangoPeriodoCaja(periodo, ahora), periodo };
  }

  const inicio = parseLimite(query.fechaInicio, 'inicio');
  const fin = parseLimite(query.fechaFin, 'fin');

  // Sin nada valido no se filtra: mismo comportamiento que antes de que
  // existiera `periodo`, para no cambiarle el resultado a quien ya llamaba.
  if (!inicio && !fin) return { periodo: 'TODO' };

  return { inicio, fin, periodo: 'RANGO' };
}
