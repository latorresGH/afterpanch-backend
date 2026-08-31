import {
  claveFecha,
  diasEnRango,
  finDelDia,
  inicioDelDia,
  inicioVentanaDias,
  parseFechaLocal,
  rangoAnterior,
  rangoDelDia,
} from './fecha.helper';

/**
 * Todo lo que hay acá se compara en hora LOCAL a propósito: es la única forma
 * de que el test valga lo mismo en la máquina del dev y en el server. Un
 * assert contra un instante UTC pasaría o fallaría según la zona del que lo
 * corre, que es justamente el bug que estos helpers existen para evitar.
 */
describe('fecha.helper', () => {
  describe('parseFechaLocal', () => {
    it('interpreta la fecha en hora local, no en UTC', () => {
      const fecha = parseFechaLocal('2026-08-01')!;

      expect(fecha.getFullYear()).toBe(2026);
      expect(fecha.getMonth()).toBe(7); // agosto
      expect(fecha.getDate()).toBe(1);
      expect(fecha.getHours()).toBe(0);
      expect(fecha.getMinutes()).toBe(0);
      expect(fecha.getSeconds()).toBe(0);
      expect(fecha.getMilliseconds()).toBe(0);
    });

    it('no se corre un día, que es lo que hace new Date(texto)', () => {
      // `new Date('2026-08-01')` da medianoche UTC: en UTC-3 eso es el 31/07
      // a las 21:00 y el rango arrancaría un día antes de lo pedido.
      const nuestro = parseFechaLocal('2026-08-01')!;
      expect(claveFecha(nuestro)).toBe('2026-08-01');
    });

    it('rechaza una fecha con forma válida pero inexistente', () => {
      // `new Date(2026, 1, 31)` no explota: rebalsa al 3 de marzo.
      expect(parseFechaLocal('2026-02-31')).toBeNull();
      expect(parseFechaLocal('2026-13-01')).toBeNull();
      expect(parseFechaLocal('2026-00-10')).toBeNull();
    });

    it('rechaza cualquier cosa que no sea YYYY-MM-DD', () => {
      expect(parseFechaLocal('01/08/2026')).toBeNull();
      expect(parseFechaLocal('2026-8-1')).toBeNull();
      expect(parseFechaLocal('2026-08-01T10:00:00Z')).toBeNull();
      expect(parseFechaLocal('')).toBeNull();
    });

    it('acepta un año bisiesto real', () => {
      expect(claveFecha(parseFechaLocal('2028-02-29')!)).toBe('2028-02-29');
    });
  });

  describe('inicioDelDia / finDelDia', () => {
    const TARDE = new Date(2026, 7, 20, 15, 30, 45, 123);

    it('lleva a las puntas del día sin cambiar la fecha', () => {
      expect(claveFecha(inicioDelDia(TARDE))).toBe('2026-08-20');
      expect(claveFecha(finDelDia(TARDE))).toBe('2026-08-20');

      expect(inicioDelDia(TARDE).getHours()).toBe(0);
      expect(finDelDia(TARDE).getHours()).toBe(23);
      expect(finDelDia(TARDE).getMinutes()).toBe(59);
      expect(finDelDia(TARDE).getMilliseconds()).toBe(999);
    });

    it('no muta la fecha que recibe', () => {
      const original = new Date(TARDE);
      inicioDelDia(TARDE);
      finDelDia(TARDE);
      expect(TARDE.getTime()).toBe(original.getTime());
    });

    it('rangoDelDia devuelve las dos puntas', () => {
      const { inicio, fin } = rangoDelDia(TARDE);
      expect(inicio.getHours()).toBe(0);
      expect(fin.getHours()).toBe(23);
    });
  });

  describe('diasEnRango', () => {
    it('cuenta los dos extremos incluidos', () => {
      const inicio = parseFechaLocal('2026-08-14')!;
      const fin = finDelDia(parseFechaLocal('2026-08-20')!);
      expect(diasEnRango(inicio, fin)).toBe(7);
    });

    it('un solo día da 1, no 0', () => {
      const dia = parseFechaLocal('2026-08-20')!;
      expect(diasEnRango(dia, finDelDia(dia))).toBe(1);
    });

    it('no depende de la hora de cada punta', () => {
      const inicio = new Date(2026, 7, 14, 23, 59, 59);
      const fin = new Date(2026, 7, 20, 0, 0, 1);
      expect(diasEnRango(inicio, fin)).toBe(7);
    });

    it('cuenta bien cruzando fin de mes', () => {
      const inicio = parseFechaLocal('2026-07-30')!;
      const fin = finDelDia(parseFechaLocal('2026-08-02')!);
      expect(diasEnRango(inicio, fin)).toBe(4);
    });
  });

  describe('rangoAnterior', () => {
    it('devuelve un bloque de la misma longitud, contiguo y sin pisarse', () => {
      const inicio = parseFechaLocal('2026-08-14')!;
      const fin = finDelDia(parseFechaLocal('2026-08-20')!);

      const previo = rangoAnterior(inicio, fin);

      expect(claveFecha(previo.inicio)).toBe('2026-08-07');
      expect(claveFecha(previo.fin)).toBe('2026-08-13');
      expect(diasEnRango(previo.inicio, previo.fin)).toBe(7);

      // Contiguo: el anterior termina justo antes de que arranque el actual.
      expect(previo.fin.getTime()).toBe(inicio.getTime() - 1);
    });

    it('arranca a medianoche, no a la hora de la punta', () => {
      const inicio = parseFechaLocal('2026-08-14')!;
      const fin = finDelDia(parseFechaLocal('2026-08-20')!);
      expect(rangoAnterior(inicio, fin).inicio.getHours()).toBe(0);
    });

    it('con un solo día devuelve el día anterior', () => {
      const dia = parseFechaLocal('2026-08-20')!;
      const previo = rangoAnterior(dia, finDelDia(dia));
      expect(claveFecha(previo.inicio)).toBe('2026-08-19');
      expect(claveFecha(previo.fin)).toBe('2026-08-19');
    });
  });

  describe('inicioVentanaDias', () => {
    it('con 7 arranca hace 6 jornadas: 7 contando hoy', () => {
      const ahora = new Date(2026, 7, 20, 15, 30);
      expect(claveFecha(inicioVentanaDias(7, ahora))).toBe('2026-08-14');
      expect(diasEnRango(inicioVentanaDias(7, ahora), finDelDia(ahora))).toBe(7);
    });

    it('con 30 también cierra la cuenta incluyendo hoy', () => {
      const ahora = new Date(2026, 7, 20, 15, 30);
      expect(diasEnRango(inicioVentanaDias(30, ahora), finDelDia(ahora))).toBe(
        30,
      );
    });
  });
});
