import { Test, TestingModule } from '@nestjs/testing';

import { AdminProductosService } from './admin-productos.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  EstadoProductoFiltro,
  OrdenProductos,
} from './dto/admin-productos-query.dto';

/** 20/08/2026 a media tarde: con `dias=7` la ventana arranca el 14. */
const AHORA = new Date(2026, 7, 20, 15, 30, 0);

/**
 * Las tres queries crudas del service se distinguen por su SQL, asi que el
 * mock rutea por contenido y no por orden de llamada: si manana cambia el
 * orden del `Promise.all`, los tests no se dan vuelta solos.
 *
 * Los fragmentos `Prisma.sql` (el CTE de ventas, el WHERE, el ORDER BY) NO
 * viajan en el template: llegan como valor interpolado, asi que hay que
 * pegarlos a mano para reconstruir la query completa.
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

describe('AdminProductosService — GET /admin/productos', () => {
  let service: AdminProductosService;
  let prisma: any;
  let sqlEjecutado: string[];
  let parametros: any[][];
  let respuestas: Record<string, any[]>;

  const PRODUCTO = {
    id: 'p1',
    nombre: 'Doble cheddar',
    precio: 9500,
    activo: true,
    esParaVenta: true,
    descripcion: 'La clasica',
    imagenUrl: null,
    codigo: 'AP-01',
    tiempoPreparacionMin: 12,
    categoriaId: 'c1',
    categoria: { id: 'c1', nombre: 'Hamburguesas', orden: 1 },
    receta: [
      {
        insumoId: 'i1',
        cantidad: 2,
        insumo: {
          id: 'i1',
          nombre: 'Medallon',
          unidadMedida: 'un',
          stockActual: 9,
          stockMinimo: 5,
          activo: true,
        },
      },
    ],
  };

  beforeEach(async () => {
    sqlEjecutado = [];
    parametros = [];
    respuestas = {
      pagina: [{ id: 'p1', unidades: 40, facturado: 380000, lineas: 22 }],
      total: [{ total: 1 }],
      extremos: [],
    };

    const queryRaw = jest.fn((strings: string[], ...valores: any[]) => {
      const sql = aplanar(Array.from(strings), valores);
      sqlEjecutado.push(sql);
      parametros.push(valores);

      const clave = sql.includes('AS total')
        ? 'total'
        : sql.includes('catalogo')
          ? 'extremos'
          : 'pagina';

      return Promise.resolve(respuestas[clave] ?? []);
    });

    prisma = {
      $queryRaw: queryRaw,
      producto: {
        groupBy: jest.fn().mockResolvedValue([
          { activo: true, _count: { _all: 12 } },
          { activo: false, _count: { _all: 3 } },
        ]),
        findMany: jest.fn().mockResolvedValue([PRODUCTO]),
      },
      categoria: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'c1',
            nombre: 'Hamburguesas',
            orden: 1,
            activo: true,
            _count: { productos: 8 },
          },
        ]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminProductosService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AdminProductosService>(AdminProductosService);
  });

  /** Todas las queries crudas concatenadas, para buscar un fragmento. */
  const todoElSql = () => sqlEjecutado.join('\n---\n');

  /** La query de la pagina (la unica con OFFSET). */
  const sqlDePagina = () => sqlEjecutado.find((s) => s.includes('OFFSET'))!;

  /** La del total de la paginacion. */
  const sqlDeTotal = () => sqlEjecutado.find((s) => s.includes('AS total'))!;

  /** La de mas/menos vendido. */
  const sqlDeExtremos = () => sqlEjecutado.find((s) => s.includes('catalogo'))!;

  /**
   * Todos los valores parametrizados, incluidos los que viajan dentro de un
   * fragmento `Prisma.sql` interpolado (el WHERE, el CTE de ventas): esos no
   * aparecen en el nivel de arriba del template.
   */
  const valoresPlanos = () => {
    const planos: any[] = [];
    const recorrer = (valores: any[]) => {
      for (const valor of valores) {
        if (
          valor &&
          typeof valor === 'object' &&
          Array.isArray(valor.strings)
        ) {
          recorrer(valor.values ?? []);
        } else {
          planos.push(valor);
        }
      }
    };
    parametros.forEach(recorrer);
    return planos;
  };

  describe('stats del header', () => {
    it('cuenta total, disponibles y pausados con un solo groupBy', async () => {
      const res = await service.listar({}, AHORA);

      expect(prisma.producto.groupBy).toHaveBeenCalledTimes(1);
      expect(res.stats).toMatchObject({
        total: 15,
        disponibles: 12,
        pausados: 3,
      });
    });

    it('mas y menos vendido salen de la misma query', async () => {
      respuestas.extremos = [
        { extremo: 'MAS', id: 'p1', nombre: 'Doble cheddar', unidades: 40 },
        { extremo: 'MENOS', id: 'p9', nombre: 'Ensalada', unidades: 0 },
      ];

      const res = await service.listar({}, AHORA);

      expect(res.stats.masVendido).toEqual({
        productoId: 'p1',
        nombre: 'Doble cheddar',
        unidades: 40,
      });
      expect(res.stats.menosVendido).toEqual({
        productoId: 'p9',
        nombre: 'Ensalada',
        unidades: 0,
      });
    });

    it('los extremos solo miran productos activos', async () => {
      await service.listar({}, AHORA);

      const extremos = sqlEjecutado.find((s) => s.includes('catalogo'))!;
      expect(extremos).toContain('p."activo" = true');
    });

    it('sin productos, los extremos son null en vez de romper', async () => {
      respuestas.extremos = [];

      const res = await service.listar({}, AHORA);

      expect(res.stats.masVendido).toBeNull();
      expect(res.stats.menosVendido).toBeNull();
    });
  });

  describe('ventas por producto', () => {
    it('solo cuenta pedidos ENTREGADO', async () => {
      await service.listar({}, AHORA);

      expect(todoElSql()).toContain('ped."estado"');
      expect(valoresPlanos()).toContain('ENTREGADO');
    });

    it('sin ?dias son el historico completo', async () => {
      const res = await service.listar({}, AHORA);

      expect(res.ventana).toEqual({ dias: null, desde: null });
      expect(todoElSql()).not.toContain('ped."createdAt" >=');
    });

    it('con ?dias acota la ventana y lo informa', async () => {
      const res = await service.listar({ dias: 7 }, AHORA);

      expect(res.ventana).toEqual({ dias: 7, desde: '2026-08-14' });
      expect(todoElSql()).toContain('ped."createdAt" >=');
    });

    it('viajan pegadas a cada item', async () => {
      const res = await service.listar({}, AHORA);

      expect(res.items[0].ventas).toEqual({
        unidades: 40,
        facturado: 380000,
        lineas: 22,
      });
    });
  });

  describe('filtros', () => {
    it('la busqueda pega contra nombre y descripcion', async () => {
      await service.listar({ q: '  cheddar  ' }, AHORA);

      expect(todoElSql()).toContain('p."nombre" ILIKE');
      expect(todoElSql()).toContain('p."descripcion"');
      expect(valoresPlanos()).toContain('%cheddar%');
    });

    it('escapa los comodines para que "50%" busque "50%"', async () => {
      await service.listar({ q: '50%' }, AHORA);

      // El ILIKE de Postgres escapa con backslash: "50%" busca 50 y un %,
      // no 50 seguido de cualquier cosa.
      expect(valoresPlanos()).toContain(`%50\\%%`);
    });

    it('el filtro por estado se resuelve en SQL', async () => {
      await service.listar({ estado: EstadoProductoFiltro.PAUSADOS }, AHORA);

      expect(todoElSql()).toContain('p."activo" = false');
    });

    it('el filtro por categoria viaja parametrizado', async () => {
      await service.listar({ categoriaId: 'c1' }, AHORA);

      expect(todoElSql()).toContain('p."categoriaId" =');
      expect(valoresPlanos()).toContain('c1');
    });

    it('sin filtros no arma WHERE', async () => {
      await service.listar({}, AHORA);

      // El WHERE del listado; la query de extremos siempre filtra por activo.
      expect(sqlDeTotal()).not.toContain('WHERE');
    });

    it('devuelve los filtros aplicados, ya normalizados', async () => {
      const res = await service.listar({ q: '  cheddar  ' }, AHORA);

      expect(res.filtros).toEqual({
        q: 'cheddar',
        categoriaId: null,
        estado: EstadoProductoFiltro.TODOS,
        orden: OrdenProductos.ALFABETICO,
      });
    });
  });

  describe('orden y paginacion', () => {
    it('mas vendidos ordena por el agregado, no en memoria', async () => {
      await service.listar({ orden: OrdenProductos.MAS_VENDIDOS }, AHORA);

      const pagina = sqlEjecutado.find((s) => s.includes('LIMIT'))!;
      expect(pagina).toContain('ORDER BY COALESCE(v.unidades, 0) DESC');
    });

    it('cada orden desempata por id para que la paginacion sea estable', async () => {
      for (const orden of Object.values(OrdenProductos)) {
        sqlEjecutado = [];
        await service.listar({ orden }, AHORA);
        const pagina = sqlEjecutado.find((s) => s.includes('LIMIT'))!;
        expect(pagina).toMatch(/ORDER BY .*p\."id" ASC/);
      }
    });

    it('el LIMIT/OFFSET los calcula Postgres', async () => {
      await service.listar({ page: 3, pageSize: 10 }, AHORA);

      const valores = valoresPlanos();
      expect(valores).toContain(10);
      expect(valores).toContain(20);
    });

    it('el total sale de una query aparte y sobrevive a la pagina vacia', async () => {
      respuestas.pagina = [];
      respuestas.total = [{ total: 42 }];

      const res = await service.listar({ page: 9, pageSize: 20 }, AHORA);

      expect(res.items).toEqual([]);
      expect(res.paginacion).toEqual({
        page: 9,
        pageSize: 20,
        total: 42,
        totalPaginas: 3,
      });
    });

    it('sin resultados devuelve una pagina, no cero', async () => {
      respuestas.pagina = [];
      respuestas.total = [{ total: 0 }];

      const res = await service.listar({}, AHORA);

      expect(res.paginacion.totalPaginas).toBe(1);
    });

    it('recorta pageSize al maximo', async () => {
      const res = await service.listar({ pageSize: 5000 }, AHORA);

      expect(res.paginacion.pageSize).toBe(100);
    });
  });

  describe('items', () => {
    it('la receta trae nombre, unidad y stock del insumo', async () => {
      const res = await service.listar({}, AHORA);

      expect(res.items[0].receta).toEqual([
        {
          insumoId: 'i1',
          cantidad: 2,
          nombre: 'Medallon',
          unidadMedida: 'un',
          stockActual: 9,
          stockMinimo: 5,
          insumoActivo: true,
        },
      ]);
    });

    it('la disponibilidad es la misma cuenta que el menu publico', async () => {
      const res = await service.listar({}, AHORA);

      // 9 medallones consumidos de a 2 => 4 unidades armables.
      expect(res.items[0]).toMatchObject({
        disponible: true,
        unidadesPosibles: 4,
      });
    });

    it('solo pide a la base los productos de la pagina', async () => {
      respuestas.pagina = [
        { id: 'p1', unidades: 40, facturado: 380000, lineas: 22 },
      ];

      await service.listar({}, AHORA);

      expect(prisma.producto.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['p1'] } } }),
      );
    });

    it('respeta el orden que fijo la query, no el de Prisma', async () => {
      respuestas.pagina = [
        { id: 'p2', unidades: 90, facturado: 1, lineas: 1 },
        { id: 'p1', unidades: 40, facturado: 1, lineas: 1 },
      ];
      prisma.producto.findMany.mockResolvedValue([
        PRODUCTO,
        { ...PRODUCTO, id: 'p2', nombre: 'Triple', receta: [] },
      ]);

      const res = await service.listar({}, AHORA);

      expect(res.items.map((i) => i.id)).toEqual(['p2', 'p1']);
    });

    it('si un producto desaparece entre las dos queries se saltea la fila', async () => {
      respuestas.pagina = [
        { id: 'p1', unidades: 40, facturado: 1, lineas: 1 },
        { id: 'borrado', unidades: 0, facturado: 0, lineas: 0 },
      ];

      const res = await service.listar({}, AHORA);

      expect(res.items.map((i) => i.id)).toEqual(['p1']);
    });

    it('no hidrata nada si la pagina vino vacia', async () => {
      respuestas.pagina = [];

      await service.listar({}, AHORA);

      expect(prisma.producto.findMany).not.toHaveBeenCalled();
    });
  });

  it('trae las categorias del filtro con su conteo', async () => {
    const res = await service.listar({}, AHORA);

    expect(res.categorias).toEqual([
      {
        id: 'c1',
        nombre: 'Hamburguesas',
        orden: 1,
        activo: true,
        productos: 8,
      },
    ]);
  });
});
