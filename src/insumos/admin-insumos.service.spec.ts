import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AdminInsumosService } from './admin-insumos.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  DisponibilidadInsumo,
  EstadoStock,
  OrdenInsumos,
  SIN_PROVEEDOR,
} from './dto/admin-insumos-query.dto';

/** 26/08/2026 a media tarde: con `dias=7` la ventana arranca el 20. */
const AHORA = new Date(2026, 7, 26, 15, 30, 0);

/**
 * Las queries crudas del service se distinguen por su SQL, asi que el mock
 * rutea por contenido y no por orden de llamada: si manana cambia el orden del
 * `Promise.all`, los tests no se dan vuelta solos.
 *
 * Los fragmentos `Prisma.sql` (el CTE de consumo, el WHERE, el ORDER BY, el
 * CASE del estado) NO viajan en el template: llegan como valor interpolado,
 * asi que hay que pegarlos a mano para reconstruir la query completa.
 */
function aplanar(strings: string[], valores: any[]): string {
  return strings
    .map((parte, i) => {
      const valor = valores[i];
      const fragmento =
        valor && typeof valor === 'object' && Array.isArray(valor.strings)
          ? aplanar(valor.strings, valor.values ?? [])
          : '';
      return parte + fragmento;
    })
    .join(' ');
}

/** Los valores escalares que realmente se parametrizan, en orden. */
function escalares(valores: any[]): any[] {
  const salida: any[] = [];
  const recorrer = (lista: any[]) => {
    for (const valor of lista) {
      if (valor && typeof valor === 'object' && Array.isArray(valor.strings)) {
        recorrer(valor.values ?? []);
      } else {
        salida.push(valor);
      }
    }
  };
  recorrer(valores);
  return salida;
}

describe('AdminInsumosService', () => {
  let service: AdminInsumosService;
  let prisma: any;
  let sqlEjecutado: string[];
  let parametros: any[][];
  let respuestas: Record<string, any[]>;

  const FILA = {
    id: 'i1',
    nombre: 'Muzzarella',
    stockActual: 3,
    stockMinimo: 8,
    unidadMedida: 'kg',
    activo: true,
    proveedorId: 'pr1',
    proveedorNombre: 'Lacteos SR',
    estado: 'BAJO',
    compraSugerida: 13,
    consumido: 29.4,
    movimientos: 12,
  };

  const CONTEOS = {
    total: 8,
    activos: 7,
    pausados: 1,
    ok: 4,
    bajo: 2,
    sinStock: 1,
    porReponer: 3,
    sinProveedor: 2,
    compraSugeridaTotal: 91.5,
    proveedoresAContactar: 2,
  };

  /**
   * Clasifica una query por un pedazo de SQL que solo ella tiene.
   * El orden importa: `pagina` y `agotan` comparten el CTE de consumo.
   */
  function clasificar(sql: string): string {
    if (sql.includes('AS total')) return 'total';
    if (sql.includes('"proveedoresAContactar"')) return 'conteos';
    if (sql.includes('"insumosEnMovimiento"') || sql.includes('AS "insumos"'))
      return 'consumoTotal';
    if (sql.includes('LIMIT') && sql.includes('c.consumido > 0'))
      return 'agotan';
    if (sql.includes('"pctDelTotal"')) return 'reporteItems';
    if (sql.includes('date_trunc')) return 'porDia';
    if (sql.includes('HAVING')) return 'reporteItems';
    if (sql.includes('OFFSET')) return 'pagina';
    return 'pagina';
  }

  beforeEach(async () => {
    sqlEjecutado = [];
    parametros = [];
    respuestas = {
      pagina: [FILA],
      total: [{ total: 1 }],
      conteos: [CONTEOS],
      consumoTotal: [
        { consumido: 210, descontado: 240, repuesto: 30, insumos: 5 },
      ],
      agotan: [],
      reporteItems: [],
      porDia: [],
    };

    const queryRaw = jest.fn((strings: string[], ...valores: any[]) => {
      const sql = aplanar(Array.from(strings), valores);
      sqlEjecutado.push(sql);
      parametros.push(escalares(valores));
      return Promise.resolve(respuestas[clasificar(sql)] ?? []);
    });

    prisma = {
      $queryRaw: queryRaw,
      proveedor: { findMany: jest.fn().mockResolvedValue([]) },
      insumo: { findUnique: jest.fn() },
      stockMovimiento: { findMany: jest.fn(), count: jest.fn() },
      pedido: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminInsumosService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AdminInsumosService);
  });

  const sqlDe = (clave: string) =>
    sqlEjecutado.find((sql) => clasificar(sql) === clave) ?? '';

  const paramsDe = (clave: string) =>
    parametros[sqlEjecutado.findIndex((sql) => clasificar(sql) === clave)] ??
    [];

  // ------------------------------------------------------------- listado

  describe('listar', () => {
    it('devuelve stats, items, paginacion, filtros, ventana y proveedores', async () => {
      const res = await service.listar({}, AHORA);

      expect(res.stats.total).toBe(8);
      expect(res.stats.porReponer).toBe(3);
      expect(res.stats.compraSugeridaTotal).toBe(91.5);
      expect(res.paginacion).toEqual({
        page: 1,
        pageSize: 25,
        total: 1,
        totalPaginas: 1,
      });
      expect(res.ventana).toEqual({
        dias: 7,
        desde: '2026-08-20',
        hasta: '2026-08-26',
        zonaHoraria: 'America/Argentina/Buenos_Aires',
      });
      expect(res.proveedores).toEqual([]);
    });

    it('el selector de proveedores trae SOLO los activos', async () => {
      await service.listar({}, AHORA);

      // Un proveedor archivado no tiene que poder elegirse en el alta de un
      // insumo: archivarlo es justamente decir que no se le compra mas. Los
      // insumos que ya lo tenian lo conservan (el nombre de la fila sale del
      // JOIN, no de esta lista), pero deja de ofrecerse.
      expect(prisma.proveedor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { activo: true } }),
      );
    });

    it('compone el item con el estado y la compra sugerida que calculo Postgres', async () => {
      const [item] = (await service.listar({}, AHORA)).items;

      expect(item.estado).toBe('BAJO');
      expect(item.compraSugerida).toBe(13);
      expect(item.proveedor).toEqual({ id: 'pr1', nombre: 'Lacteos SR' });
    });

    it('promedia el consumo sobre la ventana y estima los dias de aguante', async () => {
      const [item] = (await service.listar({ dias: 7 }, AHORA)).items;

      // 29.4 consumidos en 7 dias = 4.2 por dia; con 3 kg encima, 0.71 dias.
      expect(item.consumo.diario).toBe(4.2);
      expect(item.consumo.diasDeAguante).toBe(0.71);
    });

    it('deja los dias de aguante en null cuando no hubo consumo', async () => {
      respuestas.pagina = [{ ...FILA, consumido: 0, movimientos: 0 }];

      const [item] = (await service.listar({}, AHORA)).items;

      // null y no Infinity ni 0: no es que aguante para siempre, es que no hay
      // con que estimarlo.
      expect(item.consumo.diasDeAguante).toBeNull();
    });

    it('por defecto lista solo activos y ordena por los mas cerca de reponer', async () => {
      const res = await service.listar({}, AHORA);

      expect(res.filtros.disponibilidad).toBe(DisponibilidadInsumo.ACTIVOS);
      expect(res.filtros.orden).toBe(OrdenInsumos.POR_REPONER);
      expect(sqlDe('pagina')).toContain('i."activo" = true');
      expect(sqlDe('pagina')).toContain(
        '(i."stockActual" / GREATEST(i."stockMinimo", 1)) ASC',
      );
    });

    it('compara el estado contra el stockMinimo del insumo, nunca contra un umbral fijo', async () => {
      await service.listar({ estado: EstadoStock.POR_REPONER }, AHORA);

      expect(sqlDe('pagina')).toContain('i."stockActual" < i."stockMinimo"');
      // El CASE del estado tampoco puede tener un numero pegado.
      expect(sqlDe('pagina')).toContain(
        'WHEN i."stockActual" < i."stockMinimo" THEN',
      );
    });

    it('separa BAJO de SIN_STOCK: cero no es lo mismo que estar corto', async () => {
      await service.listar({ estado: EstadoStock.BAJO }, AHORA);
      expect(sqlDe('pagina')).toContain(
        'i."stockActual" > 0 AND i."stockActual" < i."stockMinimo"',
      );

      sqlEjecutado = [];
      await service.listar({ estado: EstadoStock.SIN_STOCK }, AHORA);
      expect(sqlDe('pagina')).toContain('i."stockActual" <= 0');
    });

    it('filtra por proveedor y por "sin proveedor" con el mismo parametro', async () => {
      await service.listar({ proveedorId: 'pr1' }, AHORA);
      expect(sqlDe('pagina')).toContain('i."proveedorId" =');
      expect(paramsDe('pagina')).toContain('pr1');

      sqlEjecutado = [];
      parametros = [];
      await service.listar({ proveedorId: SIN_PROVEEDOR }, AHORA);
      expect(sqlDe('pagina')).toContain('i."proveedorId" IS NULL');
      expect(paramsDe('pagina')).not.toContain(SIN_PROVEEDOR);
    });

    it('busca por nombre escapando los comodines del ILIKE', async () => {
      await service.listar({ q: '50%_raro' }, AHORA);

      expect(sqlDe('pagina')).toContain('i."nombre" ILIKE');
      // El patron viaja parametrizado y con los comodines escapados: "50%"
      // busca ese texto, no "50 seguido de cualquier cosa".
      expect(paramsDe('pagina')).toContain('%50\\%\\_raro%');
    });

    it('clampea el pageSize aunque el DTO deje pasar un numero grande', async () => {
      const res = await service.listar({ pageSize: 5000 }, AHORA);
      expect(res.paginacion.pageSize).toBe(100);
    });

    it('cuenta el total en una query aparte, para que sobreviva a una pagina vacia', async () => {
      respuestas.pagina = [];
      respuestas.total = [{ total: 42 }];

      const res = await service.listar({ page: 99 }, AHORA);

      expect(res.items).toEqual([]);
      expect(res.paginacion.total).toBe(42);
      expect(res.paginacion.totalPaginas).toBe(2);
    });

    it('el conteo del header no arrastra el WHERE del listado', async () => {
      await service.listar({ q: 'muzza', estado: EstadoStock.BAJO }, AHORA);

      // Las tarjetas describen el deposito, no la busqueda.
      expect(sqlDe('conteos')).not.toContain('ILIKE');
      expect(sqlDe('conteos')).not.toContain('OFFSET');
    });

    it('el consumo es neto: descuentos por pedido menos reposiciones de cancelacion', async () => {
      await service.listar({}, AHORA);

      const pagina = sqlDe('pagina');
      expect(pagina).toContain(`'DESCUENTO_PEDIDO', 'REPOSICION'`);
      expect(pagina).toContain('SUM(-"cantidad")');
      // Los ajustes manuales quedan afuera de los dos lados: comprar no es
      // consumir.
      expect(pagina).not.toContain('AJUSTE_MANUAL');
    });

    it('expone descontado y repuesto para que un consumo negativo sea explicable', async () => {
      respuestas.consumoTotal = [
        { consumido: -48, descontado: 2, repuesto: 50, insumos: 3 },
      ];

      const { stats } = await service.listar({}, AHORA);

      // Negativo NO es un bug: la reposicion de un pedido cancelado adentro de
      // la ventana puede corresponder a un descuento anterior a ella.
      expect(stats.consumo.total).toBe(-48);
      expect(stats.consumo.descontado).toBe(2);
      expect(stats.consumo.repuesto).toBe(50);
    });

    it('todos los ordenes desempatan por id, para que la paginacion sea estable', async () => {
      for (const orden of Object.values(OrdenInsumos)) {
        sqlEjecutado = [];
        await service.listar({ orden }, AHORA);
        expect(sqlDe('pagina')).toContain('i."id" ASC');
      }
    });

    it('el bloque "se agotan primero" solo mira activos con consumo', async () => {
      await service.listar({}, AHORA);

      const agotan = sqlDe('agotan');
      expect(agotan).toContain('i."activo" = true');
      expect(agotan).toContain('c.consumido > 0');
    });
  });

  // ----------------------------------------------------------- historial

  describe('historial', () => {
    const INSUMO = {
      id: 'i1',
      nombre: 'Muzzarella',
      stockActual: 3,
      stockMinimo: 8,
      unidadMedida: 'kg',
      activo: true,
      proveedor: null,
    };

    beforeEach(() => {
      prisma.insumo.findUnique.mockResolvedValue(INSUMO);
      prisma.stockMovimiento.count.mockResolvedValue(30);
      prisma.stockMovimiento.findMany.mockResolvedValue([]);
    });

    it('404 si el insumo no existe', async () => {
      prisma.insumo.findUnique.mockResolvedValue(null);

      await expect(service.historial('fantasma')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('devuelve la ficha con el estado y la compra sugerida del insumo', async () => {
      const res = await service.historial('i1');

      expect(res.insumo.estado).toBe('BAJO');
      // 8 * 2 - 3 = 13
      expect(res.insumo.compraSugerida).toBe(13);
    });

    it('clampea el limit y avisa cuantos movimientos hay en realidad', async () => {
      const res = await service.historial('i1', 99999);

      expect(res.limit).toBe(200);
      expect(prisma.stockMovimiento.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
      // `total` es el conteo real, para saber si el limite recorto.
      expect(res.total).toBe(30);
    });

    it('incluye las REPOSICION de cancelacion: el ledger no se filtra por tipo', async () => {
      prisma.stockMovimiento.findMany.mockResolvedValue([
        {
          id: 'm1',
          tipo: 'REPOSICION',
          cantidad: 2,
          stockAntes: 1,
          stockDespues: 3,
          pedidoId: 'ped-1',
          motivo: 'Cancelacion pedido: reposicion',
          userId: null,
          createdAt: AHORA,
        },
      ]);
      prisma.pedido.findMany.mockResolvedValue([
        { id: 'ped-1', tipo: 'DELIVERY', estado: 'CANCELADO' },
      ]);

      const res = await service.historial('i1');

      expect(prisma.stockMovimiento.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { insumoId: 'i1' } }),
      );
      expect(res.movimientos[0].tipo).toBe('REPOSICION');
      expect(res.movimientos[0].pedido).toEqual({
        id: 'ped-1',
        codigo: 'ped-1'.slice(-6),
        tipo: 'DELIVERY',
        estado: 'CANCELADO',
      });
    });

    it('un pedido borrado deja el movimiento en pie, con su codigo', async () => {
      prisma.stockMovimiento.findMany.mockResolvedValue([
        {
          id: 'm1',
          tipo: 'DESCUENTO_PEDIDO',
          cantidad: -1,
          stockAntes: 4,
          stockDespues: 3,
          pedidoId: 'borrado-123456',
          motivo: null,
          userId: null,
          createdAt: AHORA,
        },
      ]);
      prisma.pedido.findMany.mockResolvedValue([]);

      const res = await service.historial('i1');

      expect(res.movimientos[0].pedido).toEqual({
        id: 'borrado-123456',
        codigo: '123456',
        tipo: null,
        estado: null,
      });
    });

    it('no va a buscar pedidos si ningun movimiento cita uno', async () => {
      prisma.stockMovimiento.findMany.mockResolvedValue([
        {
          id: 'm1',
          tipo: 'AJUSTE_MANUAL',
          cantidad: 5,
          stockAntes: 0,
          stockDespues: 5,
          pedidoId: null,
          motivo: 'Recuento',
          userId: 'u1',
          createdAt: AHORA,
        },
      ]);

      const res = await service.historial('i1');

      expect(prisma.pedido.findMany).not.toHaveBeenCalled();
      expect(res.movimientos[0].pedido).toBeNull();
    });
  });

  // ------------------------------------------------------------- reporte

  describe('reporteConsumo', () => {
    const ITEM = {
      insumoId: 'i1',
      nombre: 'Muzzarella',
      unidadMedida: 'kg',
      activo: true,
      proveedorNombre: 'Lacteos SR',
      consumido: 30,
      descontado: 34,
      repuesto: 4,
      movimientos: 12,
    };

    it('sin parametros usa una ventana de 7 dias que termina hoy', async () => {
      const res = await service.reporteConsumo({}, AHORA);

      expect(res.rango).toEqual({
        desde: '2026-08-20',
        hasta: '2026-08-26',
        dias: 7,
        zonaHoraria: 'America/Argentina/Buenos_Aires',
      });
    });

    it('desde/hasta pisa a dias', async () => {
      const res = await service.reporteConsumo(
        { dias: 30, desde: '2026-08-01', hasta: '2026-08-03' },
        AHORA,
      );

      expect(res.rango.desde).toBe('2026-08-01');
      expect(res.rango.hasta).toBe('2026-08-03');
      expect(res.rango.dias).toBe(3);
    });

    it('rechaza una fecha con forma valida pero inexistente', async () => {
      await expect(
        service.reporteConsumo({ desde: '2026-02-31' }, AHORA),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza un rango invertido', async () => {
      await expect(
        service.reporteConsumo(
          { desde: '2026-08-20', hasta: '2026-08-01' },
          AHORA,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('corta el dia en hora del negocio, con el doble AT TIME ZONE', async () => {
      respuestas.reporteItems = [ITEM];
      respuestas.porDia = [
        { insumoId: 'i1', dia: '2026-08-21', consumido: 10 },
        { insumoId: 'i1', dia: '2026-08-22', consumido: 20 },
      ];

      const res = await service.reporteConsumo({ dias: 7 }, AHORA);

      const porDia = sqlDe('porDia');
      expect(porDia).toContain(`("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE`);
      // El dia vuelve como texto: un timestamp lo hidrataria el driver como
      // Date en UTC y correria la clave un dia en un server en UTC-3.
      expect(porDia).toContain('to_char');
      expect(res.items[0].porDia).toEqual([
        { dia: '2026-08-21', consumido: 10 },
        { dia: '2026-08-22', consumido: 20 },
      ]);
    });

    it('el porcentaje se mide contra el consumo total, no contra el del ranking', async () => {
      respuestas.reporteItems = [ITEM];
      respuestas.consumoTotal = [
        { consumido: 120, descontado: 130, repuesto: 10, insumos: 6 },
      ];

      const res = await service.reporteConsumo({ dias: 10 }, AHORA);

      // 30 sobre 120: si se midiera contra la suma del top, daria 100%.
      expect(res.items[0].pctDelTotal).toBe(25);
      expect(res.items[0].consumoDiario).toBe(3);
      expect(res.totales.consumido).toBe(120);
      expect(res.totales.consumoDiario).toBe(12);
    });

    it('no pide la serie diaria si el ranking salio vacio', async () => {
      respuestas.reporteItems = [];

      await service.reporteConsumo({ dias: 7 }, AHORA);

      expect(sqlEjecutado.some((sql) => sql.includes('date_trunc'))).toBe(
        false,
      );
    });

    it('descarta los insumos cuyo neto no dio consumo', async () => {
      await service.reporteConsumo({ dias: 7 }, AHORA);

      // Un insumo que solo tuvo reposiciones en el periodo no "consumio" nada.
      expect(sqlDe('reporteItems')).toContain('HAVING SUM(-m."cantidad") > 0');
    });
  });
});
