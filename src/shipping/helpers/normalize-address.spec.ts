import { normalizeAddress } from './normalize-address';

describe('normalizeAddress', () => {
  it('normaliza "Av. Corrientes 1234" y "avenida corrientes 1234" a la misma key', () => {
    expect(normalizeAddress('Av. Corrientes 1234')).toBe(
      normalizeAddress('avenida corrientes 1234'),
    );
  });

  it('normaliza "Corrientes1234" y "Corrientes 1234" a la misma key', () => {
    expect(normalizeAddress('Corrientes1234')).toBe(
      normalizeAddress('Corrientes 1234'),
    );
  });

  it('normaliza "Perú 100" y "Peru 100" a la misma key (tildes)', () => {
    expect(normalizeAddress('Perú 100')).toBe(normalizeAddress('Peru 100'));
  });

  it('normaliza "Av Corrientes  1234" (doble espacio) igual que "Av Corrientes 1234"', () => {
    expect(normalizeAddress('Av Corrientes  1234')).toBe(
      normalizeAddress('Av Corrientes 1234'),
    );
  });

  it('normaliza "AVDA. Corrientes Nº 1234" igual que "Av Corrientes 1234"', () => {
    expect(normalizeAddress('AVDA. Corrientes Nº 1234')).toBe(
      normalizeAddress('Av Corrientes 1234'),
    );
  });

  it('normaliza "calle Peru 100" igual que "av Peru 100"', () => {
    expect(normalizeAddress('calle Peru 100')).toBe(
      normalizeAddress('av Peru 100'),
    );
  });

  it('normaliza "C/ Perú Nro 500" correctamente', () => {
    expect(normalizeAddress('C/ Perú Nro 500')).toBe('av peru 500');
  });

  it('maneja strings vacíos', () => {
    expect(normalizeAddress('')).toBe('');
    expect(normalizeAddress('   ')).toBe('');
  });

  it('separa letras de números pegados en ambos sentidos', () => {
    // "calle" se normaliza a "av" en paso 8, así que el resultado es "av 123 a"
    expect(normalizeAddress('calle123a')).toContain('av 123 a');
  });
});
