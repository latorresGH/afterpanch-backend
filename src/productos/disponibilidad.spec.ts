import { disponibilidadDe } from './disponibilidad';

/**
 * La cuenta que antes hacia el navegador con la receta y el stock de todos los
 * insumos en la mano. Ahora la hace el server y manda el booleano, asi que
 * tiene que dar exactamente lo mismo que daba el front.
 */
describe('disponibilidadDe', () => {
  const linea = (cantidad: number, stockActual: number) => ({
    cantidad,
    insumo: { stockActual },
  });

  it('sin receta se vende siempre y no informa unidades', () => {
    expect(disponibilidadDe([])).toEqual({
      disponible: true,
      unidadesPosibles: null,
    });
  });

  it('se limita por el insumo mas escaso', () => {
    // 20 panes alcanzan para 20; 15 medallones de a 2 alcanzan para 7.
    expect(disponibilidadDe([linea(1, 20), linea(2, 15)])).toEqual({
      disponible: true,
      unidadesPosibles: 7,
    });
  });

  it('no se puede armar ni una unidad => no disponible', () => {
    expect(disponibilidadDe([linea(2, 1)])).toEqual({
      disponible: false,
      unidadesPosibles: 0,
    });
  });

  it('stock en cero => no disponible', () => {
    expect(disponibilidadDe([linea(1, 0)])).toEqual({
      disponible: false,
      unidadesPosibles: 0,
    });
  });

  it('una linea sin insumo se asume faltante en vez de romper', () => {
    expect(disponibilidadDe([{ cantidad: 1, insumo: null }])).toEqual({
      disponible: false,
      unidadesPosibles: 0,
    });
  });

  it('cantidad invalida (dato viejo) no divide por cero ni limita', () => {
    expect(
      disponibilidadDe([{ cantidad: 0, insumo: { stockActual: 5 } }]),
    ).toEqual({
      disponible: true,
      unidadesPosibles: null,
    });

    expect(disponibilidadDe([linea(0, 5), linea(1, 3)])).toEqual({
      disponible: true,
      unidadesPosibles: 3,
    });
  });
});
