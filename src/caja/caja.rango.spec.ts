import { parseLimite, resolverRangoCaja } from './caja.rango';

const AHORA = new Date(2026, 5, 15, 21, 0); // 15/06/2026 21:00 local

const legible = (d?: Date) =>
  d
    ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ` +
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:` +
      `${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
    : 'sin límite';

describe('resolverRangoCaja — de la URL al rango', () => {
  describe('?periodo=HOY|AYER (día comercial, corte 02:30)', () => {
    it('HOY es la jornada en curso', () => {
      const r = resolverRangoCaja({ periodo: 'HOY' }, AHORA);

      expect(legible(r.inicio)).toBe('15/06 02:30:00.000');
      expect(legible(r.fin)).toBe('16/06 02:29:59.999');
      expect(r.periodo).toBe('HOY');
    });

    it('AYER es la jornada anterior, contigua', () => {
      const r = resolverRangoCaja({ periodo: 'AYER' }, AHORA);

      expect(legible(r.inicio)).toBe('14/06 02:30:00.000');
      expect(legible(r.fin)).toBe('15/06 02:29:59.999');
      expect(r.periodo).toBe('AYER');
    });

    it('acepta minúsculas (la URL la escribe cualquiera)', () => {
      expect(resolverRangoCaja({ periodo: 'hoy' }, AHORA).periodo).toBe('HOY');
    });

    it('a la 01:00 sigue mostrando la noche que se acaba de trabajar', () => {
      const r = resolverRangoCaja({ periodo: 'HOY' }, new Date(2026, 5, 16, 1, 0));

      expect(legible(r.inicio)).toBe('15/06 02:30:00.000');
    });

    it('gana sobre fechaInicio/fechaFin si vienen los dos', () => {
      const r = resolverRangoCaja(
        { periodo: 'HOY', fechaInicio: '2020-01-01', fechaFin: '2020-01-31' },
        AHORA,
      );

      expect(r.periodo).toBe('HOY');
      expect(legible(r.inicio)).toBe('15/06 02:30:00.000');
    });

    it('un periodo inventado cae al rango a mano, no revienta', () => {
      const r = resolverRangoCaja({ periodo: 'CHIRIMBOLO' }, AHORA);

      expect(r.periodo).toBe('TODO');
      expect(r.inicio).toBeUndefined();
    });
  });

  describe('?fechaInicio / ?fechaFin (rango a mano)', () => {
    it('una fecha sola se expande al día LOCAL completo', () => {
      const r = resolverRangoCaja({
        fechaInicio: '2026-09-07',
        fechaFin: '2026-09-07',
      });

      expect(legible(r.inicio)).toBe('07/09 00:00:00.000');
      expect(legible(r.fin)).toBe('07/09 23:59:59.999');
      expect(r.periodo).toBe('RANGO');
    });

    it('BUG VIEJO: una fecha sola ya no corre el rango un día para atrás', () => {
      // `new Date('2026-09-07')` se interpreta como UTC: en un server en UTC-3
      // eso es el 06 a las 21:00, y el rango arrancaba un día antes.
      const r = resolverRangoCaja({ fechaInicio: '2026-09-07' });

      expect(r.inicio?.getDate()).toBe(7);
      expect(r.inicio?.getMonth()).toBe(8); // septiembre
    });

    it('un ISO con hora se respeta tal cual (no se normaliza a día)', () => {
      const r = resolverRangoCaja({
        fechaInicio: new Date(2026, 5, 15, 2, 30).toISOString(),
      });

      expect(legible(r.inicio)).toBe('15/06 02:30:00.000');
    });

    it('solo una punta también sirve', () => {
      const r = resolverRangoCaja({ fechaInicio: '2026-09-07' });

      expect(r.inicio).toBeDefined();
      expect(r.fin).toBeUndefined();
      expect(r.periodo).toBe('RANGO');
    });

    it('sin nada, no filtra: mismo comportamiento que antes', () => {
      const r = resolverRangoCaja({});

      expect(r).toEqual({ periodo: 'TODO' });
    });

    it('basura escrita a mano se ignora en vez de voltear la pantalla', () => {
      expect(resolverRangoCaja({ fechaInicio: 'chirimbolo' }).periodo).toBe('TODO');
      expect(resolverRangoCaja({ fechaInicio: '2026-02-31' }).periodo).toBe('TODO');
      expect(resolverRangoCaja({ fechaInicio: '   ' }).periodo).toBe('TODO');
    });
  });
});

describe('parseLimite', () => {
  it('expande según el extremo que se pida', () => {
    expect(legible(parseLimite('2026-09-07', 'inicio'))).toBe('07/09 00:00:00.000');
    expect(legible(parseLimite('2026-09-07', 'fin'))).toBe('07/09 23:59:59.999');
  });

  it('devuelve undefined para lo que no sirve', () => {
    for (const v of ['', '   ', undefined, 'ayer', '07-09-2026']) {
      expect(parseLimite(v, 'inicio')).toBeUndefined();
    }
  });
});
