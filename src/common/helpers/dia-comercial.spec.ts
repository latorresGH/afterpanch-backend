import {
  CORTE_DIA_COMERCIAL,
  esPeriodoCaja,
  inicioDiaComercial,
  rangoDiaComercial,
  rangoPeriodoCaja,
} from './fecha.helper';

/**
 * El corte de las 02:30.
 *
 * El local cierra despues de medianoche: cortar el dia a las 00:00 partiria
 * cada noche en dos jornadas. Todo lo de aca abajo es hora local (el proceso
 * corre con TZ de Buenos Aires, ver main.ts).
 */

/** `en(6, 15, 2, 29, 59, 999)` → 15/06/2026 02:29:59.999 local. */
const en = (
  dia: number,
  hora: number,
  minuto = 0,
  segundo = 0,
  ms = 0,
  mes = 6,
) => new Date(2026, mes - 1, dia, hora, minuto, segundo, ms);

const legible = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ` +
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:` +
  `${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;

describe('el corte de dia comercial esta donde se acordo', () => {
  it('son las 02:30', () => {
    expect(CORTE_DIA_COMERCIAL).toEqual({ hora: 2, minuto: 30 });
  });
});

describe('inicioDiaComercial — a que jornada pertenece cada momento', () => {
  it.each([
    // [momento,                        jornada a la que pertenece, por que]
    [en(15, 14, 0), 15, 'una tarde cualquiera cae en su propio dia'],
    [en(15, 23, 59, 59, 999), 15, 'un minuto antes de medianoche, sigue siendo el 15'],
    [en(16, 0, 0), 15, 'medianoche NO corta: la noche del 15 sigue'],
    [en(16, 1, 40), 15, 'la 01:40 del 16 es plata de la noche del 15'],
    [en(16, 2, 29, 59, 999), 15, 'un milisegundo antes del corte, todavia es el 15'],
    [en(16, 2, 30, 0, 0), 16, 'el corte en punto ya abre la jornada del 16'],
    [en(16, 2, 30, 0, 1), 16, 'un milisegundo despues del corte, sin dudas el 16'],
    [en(16, 3, 0), 16, 'las 03:00 del 16 son del 16'],
  ])('%s → jornada del %i (%s)', (momento, diaEsperado) => {
    const inicio = inicioDiaComercial(momento as Date);

    expect(inicio.getDate()).toBe(diaEsperado);
    expect(inicio.getHours()).toBe(2);
    expect(inicio.getMinutes()).toBe(30);
    expect(inicio.getSeconds()).toBe(0);
    expect(inicio.getMilliseconds()).toBe(0);
  });

  it('no muta la fecha que recibe', () => {
    const ahora = en(16, 1, 40);
    const copia = new Date(ahora);

    inicioDiaComercial(ahora);

    expect(ahora.getTime()).toBe(copia.getTime());
  });
});

describe('rangoDiaComercial — los dos extremos', () => {
  it('HOY va de las 02:30 de hoy a las 02:29:59.999 de mañana', () => {
    const { inicio, fin } = rangoDiaComercial(en(15, 21, 0));

    expect(legible(inicio)).toBe('15/06 02:30:00.000');
    expect(legible(fin)).toBe('16/06 02:29:59.999');
  });

  it('dura exactamente 24 horas menos un milisegundo', () => {
    const { inicio, fin } = rangoDiaComercial(en(15, 21, 0));
    const VEINTICUATRO_HORAS = 24 * 60 * 60 * 1000;

    expect(fin.getTime() - inicio.getTime()).toBe(VEINTICUATRO_HORAS - 1);
  });

  it('AYER termina justo cuando arranca HOY: ni se pisan ni dejan hueco', () => {
    const ahora = en(15, 21, 0);
    const hoy = rangoDiaComercial(ahora, 0);
    const ayer = rangoDiaComercial(ahora, 1);

    expect(ayer.fin.getTime() + 1).toBe(hoy.inicio.getTime());
  });

  it('un movimiento cae en exactamente un periodo, nunca en dos', () => {
    const ahora = en(16, 1, 40);
    const hoy = rangoDiaComercial(ahora, 0);
    const ayer = rangoDiaComercial(ahora, 1);

    const momentos = [
      en(15, 2, 30), // arranque de hoy
      en(15, 20, 0),
      en(16, 0, 30), // pasada la medianoche
      en(16, 2, 29, 59, 999), // ultimo instante de hoy
      en(14, 3, 0), // ayer
      en(15, 2, 29, 59, 999), // ultimo instante de ayer
    ];

    const dentro = (r: { inicio: Date; fin: Date }, m: Date) =>
      m >= r.inicio && m <= r.fin;

    for (const m of momentos) {
      const enHoy = dentro(hoy, m);
      const enAyer = dentro(ayer, m);
      expect(`${legible(m)} → hoy:${enHoy} ayer:${enAyer}`).not.toBe(
        `${legible(m)} → hoy:true ayer:true`,
      );
    }
  });

  it('cruza el fin de mes sin romperse', () => {
    const { inicio, fin } = rangoDiaComercial(en(30, 23, 0), 0);

    expect(legible(inicio)).toBe('30/06 02:30:00.000');
    expect(legible(fin)).toBe('01/07 02:29:59.999');
  });

  it('el AYER del primero de mes es el ultimo dia del mes anterior', () => {
    const { inicio } = rangoDiaComercial(new Date(2026, 6, 1, 20, 0), 1);

    expect(legible(inicio)).toBe('30/06 02:30:00.000');
  });
});

describe('rangoPeriodoCaja — lo que pide el frontend', () => {
  it('HOY a las 21:00 del 15 es la jornada del 15', () => {
    const { inicio, fin } = rangoPeriodoCaja('HOY', en(15, 21, 0));

    expect(legible(inicio)).toBe('15/06 02:30:00.000');
    expect(legible(fin)).toBe('16/06 02:29:59.999');
  });

  it('a la 01:00 del 16, HOY SIGUE SIENDO la jornada del 15', () => {
    // El caso que importa: el cajero cierra a la 01:00 y "hoy" tiene que
    // seguir mostrando la noche que acaba de trabajar, no una caja vacia.
    const { inicio, fin } = rangoPeriodoCaja('HOY', en(16, 1, 0));

    expect(legible(inicio)).toBe('15/06 02:30:00.000');
    expect(legible(fin)).toBe('16/06 02:29:59.999');
  });

  it('a las 02:31 del 16 ya cambio el dia: HOY es la jornada del 16', () => {
    const { inicio } = rangoPeriodoCaja('HOY', en(16, 2, 31));

    expect(legible(inicio)).toBe('16/06 02:30:00.000');
  });

  it('AYER a la 01:00 del 16 es la jornada del 14', () => {
    // Si "hoy" es el 15 (porque a la 01:00 del 16 seguimos en el 15),
    // "ayer" tiene que ser el 14.
    const { inicio, fin } = rangoPeriodoCaja('AYER', en(16, 1, 0));

    expect(legible(inicio)).toBe('14/06 02:30:00.000');
    expect(legible(fin)).toBe('15/06 02:29:59.999');
  });
});

describe('esPeriodoCaja — lo que llega por la URL', () => {
  it.each(['HOY', 'AYER', 'hoy', 'ayer'])('acepta %s', (v) => {
    expect(esPeriodoCaja(v)).toBe(true);
  });

  it.each(['SEMANA', 'chirimbolo', '', null, undefined, 3, {}])(
    'rechaza %p',
    (v) => {
      expect(esPeriodoCaja(v)).toBe(false);
    },
  );
});
