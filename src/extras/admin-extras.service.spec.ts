import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AdminExtrasService } from './admin-extras.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AlcanceExtra,
  DisponibilidadExtra,
  EstadoStockExtra,
  OrdenExtras,
} from './dto/admin-extras-query.dto';

/** 27/08/2026 a media tarde: con `dias=7` la ventana arranca el 21. */
const AHORA = new Date(2026, 7, 27, 15, 30, 0);

/**
 * Las queries crudas del service se distinguen por su SQL, asi que el mock
 * rutea por contenido y no por orden de llamada: si manana cambia el orden del
 * `Promise.all`, los tests no se dan vuelta solos.
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

describe('AdminExtrasService', () => {
  let service: AdminExtrasService;
  let prisma: any;
  let sqlEjecutado: string[];
  let parametros: any[][];
  let respuestas: Record<string, any[]>;

  const FILA = {
    id: 'x1',
    nombre: 'Cheddar extra',
    precio: 2200,
    unidadMedida: 'u',
    stockActual: 4,
    stockMinimo: 18,
    activo: true,
    esGlobal: false,
    esPremium: true,
    estado: 'BAJO',
    insumoId: null,
    insumoNombre: null,
    categorias: 2,
    precios: 2,
    consumos: 1,
    unidades: 37,
    gratis: 5,
    cobrados: 32,
    recaudado: 70400,
  };

  const CONTEOS = {
    total: 6,
    activos: 5,
    pausados: 1,
    ok: 3,
    bajo: 1,
    sinStock: 1,
    porReponer: 2,
    premium: 2,
    globales: 2,
    sinAlcance: 1,
    sinConsumoConfigurado: 3,
  };

  const TOTALES_FACT = {
    unidades: 163,
    gratis: 40,
    cobrados: 123,
    recaudado: 180000,
    recaudadoPremium: 72000,
  };

  /** Clasifica una query por un pedazo de SQL que solo ella tiene. */
  function clasificar(sql: string): string {
    if (sql.includes('"sinConsumoConfigurado"')) return 'conteos';
    if (sql.includes('"recaudadoPremium"')) return 'factTotales';
    if (sql.includes('LIMIT') && sql.includes("GROUP BY ex->>'id'") && sql.includes('ORDER BY 4 DESC'))
      return 'factShare';
    if (sql.includes('AS usado')) return 'usado';
    if (sql.includes('FROM "ExtraCategoria" ec') && sql.includes('JOIN pagina'))
      return 'categorias';
    if (sql.includes('AS total')) return 'total';
    if (sql.includes('OFFSET')) return 'pagina';
    return 'desconocida';
  }

  beforeEach(async () => {
    sqlEjecutado = [];
    parametros = [];
    respuestas = {
      pagina: [FILA],
      total: [{ total: 1 }],
      conteos: [CONTEOS],
      factTotales: [TOTALES_FACT],
      factShare: [],
      categorias: [],
      usado: [{ usado: false }],
    };

    const queryRaw = jest.fn((strings: string[], ...valores: any[]) => {
      const sql = aplanar(Array.from(strings), valores);
      sqlEjecutado.push(sql);
      parametros.push(escalares(valores));
      return Promise.resolve(respuestas[clasificar(sql)] ?? []);
    });

    const tx = {
      extra: {
        create: jest.fn((a: any) => Promise.resolve({ id: 'nuevo', ...a.data })),
        update: jest.fn((a: any) => Promise.resolve({ id: a.where.id, ...a.data })),
        delete: jest.fn().mockResolvedValue({}),
      },
      extraCategoria: { deleteMany: jest.fn(), createMany: jest.fn() },
      extraPrecio: { deleteMany: jest.fn(), createMany: jest.fn() },
      extraConsumo: { deleteMany: jest.fn(), createMany: jest.fn() },
      stockMovimiento: { deleteMany: jest.fn() },
    };

    prisma = {
      $queryRaw: queryRaw,
      $transaction: jest.fn((fn: any) => fn(tx)),
      __tx: tx,
      extra: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'x1',
          nombre: 'Cheddar extra',
          precio: 2200,
          unidadMedida: 'u',
          stockActual: 4,
          stockMinimo: 18,
          activo: true,
          esGlobal: false,
          esPremium: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          insumo: null,
          categoriasAplica: [{ categoriaId: 'c1' }],
          preciosPorCategoria: [{ categoriaId: 'c1', precio: 2200 }],
          consumosPorCategoria: [],
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      categoria: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'c1', nombre: 'Hamburguesas', activo: true, cantExtrasGratis: 2, sinExtrasNiAderezos: false },
          { id: 'c2', nombre: 'Pizzas', activo: true, cantExtrasGratis: 2, sinExtrasNiAderezos: true },
        ]),
      },
      insumo: { findUnique: jest.fn().mockResolvedValue({ id: 'i1' }) },
      stockMovimiento: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AdminExtrasService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(AdminExtrasService);
  });

  const sqlDe = (clave: string) =>
    sqlEjecutado.find((sql) => clasificar(sql) === clave) ?? '';
  const paramsDe = (clave: string) =>
    parametros[sqlEjecutado.findIndex((sql) => clasificar(sql) === clave)] ?? [];

  // ------------------------------------------------------------- listado

  describe('listar', () => {
    it('devuelve stats, items, paginacion, filtros y ventana', async () => {
      const res = await service.listar({}, AHORA);

      expect(res.stats.total).toBe(6);
      expect(res.stats.porReponer).toBe(2);
      expect(res.stats.sinConsumoConfigurado).toBe(3);
      expect(res.paginacion).toEqual({
        page: 1,
        pageSize: 20,
        total: 1,
        totalPaginas: 1,
      });
      expect(res.ventana).toEqual({
        dias: 7,
        desde: '2026-08-21',
        hasta: '2026-08-27',
        zonaHoraria: 'America/Argentina/Buenos_Aires',
      });
    });

    it('por defecto muestra solo los activos', async () => {
      await service.listar({}, AHORA);
      expect(sqlDe('pagina')).toContain('e."activo" = true');
    });

    it('filtra por estado de stock contra el minimo DEL EXTRA', async () => {
      await service.listar({ estado: EstadoStockExtra.POR_REPONER }, AHORA);
      expect(sqlDe('pagina')).toContain('e."stockActual" < e."stockMinimo"');
    });

    it('el alcance SIN_ALCANCE busca los que no se ofrecen en ningun lado', async () => {
      await service.listar({ alcance: AlcanceExtra.SIN_ALCANCE }, AHORA);

      const sql = sqlDe('pagina');
      expect(sql).toContain('e."esGlobal" = false');
      expect(sql).toContain('NOT EXISTS');
    });

    it('filtrar por categoria incluye a los globales', async () => {
      await service.listar({ categoriaId: 'c1' }, AHORA);

      // Un extra global se ofrece en todas las categorias: si el filtro solo
      // mirara ExtraCategoria, desapareceria de su propia categoria.
      const sql = sqlDe('pagina');
      expect(sql).toContain('e."esGlobal" = true');
      expect(paramsDe('pagina')).toContain('c1');
    });

    it('filtra por premium', async () => {
      await service.listar({ premium: 'true' }, AHORA);
      expect(sqlDe('pagina')).toContain('e."esPremium" = true');

      sqlEjecutado = [];
      await service.listar({ premium: 'false' }, AHORA);
      expect(sqlDe('pagina')).toContain('e."esPremium" = false');
    });

    it('busca por nombre escapando los comodines del ILIKE', async () => {
      await service.listar({ q: '50%' }, AHORA);

      expect(sqlDe('pagina')).toContain('e."nombre" ILIKE');
      expect(paramsDe('pagina')).toContain('%50\\%%');
    });

    it('ordena por reponer por defecto y respeta el orden pedido', async () => {
      await service.listar({}, AHORA);
      expect(sqlDe('pagina')).toContain('e."stockActual" / GREATEST');

      sqlEjecutado = [];
      await service.listar({ orden: OrdenExtras.MAS_PEDIDOS }, AHORA);
      expect(sqlDe('pagina')).toContain('COALESCE(v.unidades, 0) DESC');
    });

    it('clampea el pageSize al maximo', async () => {
      const res = await service.listar({ pageSize: 5000 }, AHORA);

      expect(res.paginacion.pageSize).toBe(100);
      expect(paramsDe('pagina')).toContain(100);
    });

    it('los conteos del header NO se filtran por la busqueda', async () => {
      await service.listar(
        { q: 'cheddar', disponibilidad: DisponibilidadExtra.PAUSADOS },
        AHORA,
      );

      expect(sqlDe('conteos')).not.toContain('ILIKE');
      expect(sqlDe('conteos')).not.toContain('e."activo" = false');
    });

    it('compone el item con el alcance y las ventas resueltas', async () => {
      respuestas.categorias = [
        { extraId: 'x1', id: 'c1', nombre: 'Hamburguesas' },
        { extraId: 'x1', id: 'c2', nombre: 'Papas' },
      ];

      const [item] = (await service.listar({}, AHORA)).items;

      expect(item.estado).toBe('BAJO');
      expect(item.esPremium).toBe(true);
      expect(item.alcance).toEqual({
        esGlobal: false,
        categorias: [
          { id: 'c1', nombre: 'Hamburguesas' },
          { id: 'c2', nombre: 'Papas' },
        ],
        sinAlcance: false,
      });
      expect(item.ventas).toEqual({
        unidades: 37,
        gratis: 5,
        cobrados: 32,
        recaudado: 70400,
      });
    });

    it('marca sinAlcance cuando no es global y no tiene categorias', async () => {
      respuestas.categorias = [];
      const [item] = (await service.listar({}, AHORA)).items;

      // Existe, esta activo y con stock, pero no aparece en ningun producto.
      expect(item.alcance.sinAlcance).toBe(true);
    });

    it('el precio promedio se calcula sobre los COBRADOS, no sobre las unidades', async () => {
      const { facturacion } = (await service.listar({}, AHORA)).stats;

      // 180000 / 123 cobrados = 1463.41; dividir por las 163 unidades daria
      // 1104, mas bajo que cualquier precio real de la carta.
      expect(facturacion.precioPromedio).toBe(1463.41);
      expect(facturacion.pctGratis).toBe(24.5);
      expect(facturacion.pctPremium).toBe(40);
    });

    it('no divide por cero cuando no hubo ventas en la ventana', async () => {
      respuestas.factTotales = [
        { unidades: 0, gratis: 0, cobrados: 0, recaudado: 0, recaudadoPremium: 0 },
      ];

      const { facturacion } = (await service.listar({}, AHORA)).stats;

      expect(facturacion.precioPromedio).toBe(0);
      expect(facturacion.pctPremium).toBe(0);
      expect(facturacion.pctGratis).toBe(0);
    });

    it('la facturacion solo cuenta pedidos ENTREGADOS', async () => {
      await service.listar({}, AHORA);
      expect(sqlDe('factTotales')).toContain(`ped."estado" = 'ENTREGADO'`);
    });
  });

  // ------------------------------------------------------------- detalle

  describe('detalle', () => {
    it('404 si el extra no existe', async () => {
      prisma.extra.findUnique.mockResolvedValue(null);
      await expect(service.detalle('fantasma')).rejects.toThrow(NotFoundException);
    });

    it('devuelve una fila por categoria activa, no solo por las configuradas', async () => {
      const res = await service.detalle('x1');

      expect(res.categorias).toHaveLength(2);
      expect(res.categorias.map((c) => c.nombre)).toEqual([
        'Hamburguesas',
        'Pizzas',
      ]);
    });

    it('marca el precio y el consumo que salen de un default', async () => {
      const [hamburguesas, pizzas] = (await service.detalle('x1')).categorias;

      // Hamburguesas tiene precio propio y NO tiene consumo cargado.
      expect(hamburguesas.precio).toBe(2200);
      expect(hamburguesas.precioEnDefault).toBe(false);
      expect(hamburguesas.consumo).toBeNull();
      expect(hamburguesas.consumoEfectivo).toBe(1);
      expect(hamburguesas.consumoEnDefault).toBe(true);

      // Pizzas no tiene nada: el precio efectivo cae al base.
      expect(pizzas.precioEfectivo).toBe(2200);
      expect(pizzas.precioEnDefault).toBe(true);
    });

    it('consumoFaltante solo marca las categorias donde el extra SE OFRECE', async () => {
      const [hamburguesas, pizzas] = (await service.detalle('x1')).categorias;

      // Se ofrece en Hamburguesas (categoriasAplica) y ahi falta el consumo:
      // ese es el caso que hace descontar 1 a ciegas.
      expect(hamburguesas.aplica).toBe(true);
      expect(hamburguesas.consumoFaltante).toBe(true);

      // En Pizzas no se ofrece, asi que su consumo sin cargar no molesta.
      expect(pizzas.aplica).toBe(false);
      expect(pizzas.consumoFaltante).toBe(false);
    });

    it('un extra global aplica a todas las categorias sin tener filas', async () => {
      prisma.extra.findUnique.mockResolvedValue({
        id: 'x2',
        nombre: 'Papitas',
        precio: 1800,
        unidadMedida: 'u',
        stockActual: 62,
        stockMinimo: 20,
        activo: true,
        esGlobal: true,
        esPremium: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        insumo: null,
        categoriasAplica: [],
        preciosPorCategoria: [],
        consumosPorCategoria: [],
      });

      const res = await service.detalle('x2');

      expect(res.alcance.categoriasAlcanzadas).toBe(2);
      expect(res.categorias.every((c) => c.aplica)).toBe(true);
      // Y por eso le faltan los DOS consumos, no ninguno.
      expect(res.resumen.consumosFaltantes).toBe(2);
    });

    it('avisa que una categoria no admite extras', async () => {
      const [, pizzas] = (await service.detalle('x1')).categorias;
      expect(pizzas.admiteExtras).toBe(false);
    });
  });

  // ------------------------------------------------------------- escritura

  describe('crear', () => {
    it('persiste esPremium (el service viejo lo ignoraba en el alta)', async () => {
      await service.crear({
        nombre: 'Panceta',
        stockMinimo: 10,
        esPremium: true,
      } as any);

      expect(prisma.__tx.extra.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ esPremium: true, stockMinimo: 10 }),
        }),
      );
    });

    it('recorta el nombre antes de chequear el duplicado', async () => {
      await service.crear({ nombre: '  Panceta  ', stockMinimo: 10 } as any);

      expect(prisma.extra.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            nombre: { equals: 'Panceta', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('rechaza un nombre repetido con 409', async () => {
      prisma.extra.findFirst.mockResolvedValue({
        id: 'x9',
        nombre: 'Panceta',
        activo: true,
      });

      await expect(
        service.crear({ nombre: 'panceta', stockMinimo: 10 } as any),
      ).rejects.toThrow(ConflictException);
      expect(prisma.__tx.extra.create).not.toHaveBeenCalled();
    });

    it('rechaza una categoria inexistente con 400 y no con un 500 de FK', async () => {
      prisma.categoria.findMany.mockResolvedValue([]);

      await expect(
        service.crear({
          nombre: 'Panceta',
          stockMinimo: 10,
          categoriaIds: ['no-existe'],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza un insumo inexistente', async () => {
      prisma.insumo.findUnique.mockResolvedValue(null);

      await expect(
        service.crear({ nombre: 'X', stockMinimo: 10, insumoId: 'i9' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('guarda extra y configuracion en la MISMA transaccion', async () => {
      await service.crear({
        nombre: 'Panceta',
        stockMinimo: 10,
        categoriaIds: ['c1'],
        consumos: [{ categoriaId: 'c1', cantidadConsumo: 30 }],
      } as any);

      // Un extra con las categorias nuevas y los consumos viejos es justo el
      // estado desalineado que esta seccion viene a arreglar.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.__tx.extraConsumo.createMany).toHaveBeenCalled();
    });
  });

  describe('editar', () => {
    beforeEach(() => {
      // `editar` arranca leyendo el estado actual para poder validar el
      // consumo sobre el estado FINAL, no sobre el body.
      prisma.extra.findUnique.mockResolvedValue({
        id: 'x1',
        nombre: 'Cheddar extra',
        precio: 2200,
        unidadMedida: 'u',
        stockActual: 4,
        stockMinimo: 18,
        activo: true,
        esGlobal: false,
        esPremium: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        insumo: null,
        categoriasAplica: [{ categoriaId: 'c1' }],
        preciosPorCategoria: [{ categoriaId: 'c1', precio: 2200 }],
        consumosPorCategoria: [{ categoriaId: 'c1', cantidadConsumo: 50 }],
      });
    });

    it('un array vacio BORRA ese bloque; omitirlo lo deja como estaba', async () => {
      await service.editar('x1', { precios: [] } as any);

      expect(prisma.__tx.extraPrecio.deleteMany).toHaveBeenCalledWith({
        where: { extraId: 'x1' },
      });
      expect(prisma.__tx.extraPrecio.createMany).not.toHaveBeenCalled();
      // `consumos` no vino: no se toca.
      expect(prisma.__tx.extraConsumo.deleteMany).not.toHaveBeenCalled();
      expect(prisma.__tx.extraCategoria.deleteMany).not.toHaveBeenCalled();
    });

    it('reemplaza el set completo de consumos cuando vienen', async () => {
      await service.editar('x1', {
        consumos: [
          { categoriaId: 'c1', cantidadConsumo: 50 },
          { categoriaId: 'c2', cantidadConsumo: 30 },
        ],
      } as any);

      expect(prisma.__tx.extraConsumo.deleteMany).toHaveBeenCalled();
      expect(prisma.__tx.extraConsumo.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            { extraId: 'x1', categoriaId: 'c1', cantidadConsumo: 50 },
            { extraId: 'x1', categoriaId: 'c2', cantidadConsumo: 30 },
          ],
        }),
      );
    });

    it('deduplica las categorias del alcance', async () => {
      await service.editar('x1', {
        categoriaIds: ['c1', 'c1', 'c2'],
        consumos: [
          { categoriaId: 'c1', cantidadConsumo: 5 },
          { categoriaId: 'c2', cantidadConsumo: 5 },
        ],
      } as any);

      expect(prisma.__tx.extraCategoria.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            { extraId: 'x1', categoriaId: 'c1' },
            { extraId: 'x1', categoriaId: 'c2' },
          ],
        }),
      );
    });

    it('404 si no existe', async () => {
      prisma.extra.findUnique.mockResolvedValue(null);
      await expect(service.editar('fantasma', {} as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('al chequear el nombre repetido se ignora a si mismo', async () => {
      await service.editar('x1', { nombre: 'Cheddar extra' } as any);

      expect(prisma.extra.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 'x1' } }),
        }),
      );
    });
  });

  describe('eliminar', () => {
    it('bloquea el borrado si el extra ya se vendio', async () => {
      respuestas.usado = [{ usado: true }];

      await expect(service.eliminar('x1')).rejects.toThrow(BadRequestException);
      expect(prisma.__tx.extra.delete).not.toHaveBeenCalled();
    });

    it('tener movimientos de stock NO bloquea: lo unico que bloquea son las ventas', async () => {
      prisma.stockMovimiento.count.mockResolvedValue(4);

      // Mismo criterio que Productos: lo unico que impide eliminar es haber
      // sido usado en pedidos. Un ajuste manual sobre un extra que nunca se
      // vendio no tiene por que dejarlo sin poder borrarse.
      await expect(service.eliminar('x1')).resolves.toEqual({
        ok: true,
        id: 'x1',
      });
    });

    it('se lleva los movimientos: el FK es SET NULL y quedarian huerfanos', async () => {
      await service.eliminar('x1');

      expect(prisma.__tx.stockMovimiento.deleteMany).toHaveBeenCalledWith({
        where: { extraId: 'x1' },
      });
    });

    it('borra cuando nunca se uso', async () => {
      const res = await service.eliminar('x1');

      expect(res).toEqual({ ok: true, id: 'x1' });
      expect(prisma.__tx.extra.delete).toHaveBeenCalledWith({
        where: { id: 'x1' },
      });
    });
  });

  describe('consumo obligatorio donde el extra se ofrece', () => {
    it('rechaza ofrecer un extra en una categoria sin decir cuanto descuenta', async () => {
      await expect(
        service.crear({
          nombre: 'Panceta',
          stockMinimo: 10,
          categoriaIds: ['c1'],
        } as any),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.__tx.extra.create).not.toHaveBeenCalled();
    });

    it('nombra las categorias que faltan', async () => {
      await expect(
        service.crear({
          nombre: 'Panceta',
          stockMinimo: 10,
          categoriaIds: ['c1', 'c2'],
          consumos: [{ categoriaId: 'c1', cantidadConsumo: 30 }],
        } as any),
      ).rejects.toThrow(/Pizzas/);
    });

    it('un extra GLOBAL necesita el consumo de TODAS las categorias', async () => {
      // Se ofrece en toda la carta, asi que cualquier categoria sin consumo es
      // una venta que descontaria 1 a ciegas.
      await expect(
        service.crear({
          nombre: 'Papitas',
          stockMinimo: 20,
          esGlobal: true,
          consumos: [{ categoriaId: 'c1', cantidadConsumo: 1 }],
        } as any),
      ).rejects.toThrow(/global/i);

      await expect(
        service.crear({
          nombre: 'Papitas',
          stockMinimo: 20,
          esGlobal: true,
          consumos: [
            { categoriaId: 'c1', cantidadConsumo: 1 },
            { categoriaId: 'c2', cantidadConsumo: 1 },
          ],
        } as any),
      ).resolves.toBeDefined();
    });

    it('un consumo en 0 no cuenta como cargado', async () => {
      // El @Min del DTO lo ataja por HTTP; esto cubre al service, que esta
      // exportado y no puede depender del ValidationPipe.
      await expect(
        service.crear({
          nombre: 'Panceta',
          stockMinimo: 10,
          categoriaIds: ['c1'],
          consumos: [{ categoriaId: 'c1', cantidadConsumo: 0 }],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('sin alcance no exige nada: no se ofrece en ningun lado', async () => {
      await expect(
        service.crear({ nombre: 'Huerfano', stockMinimo: 5 } as any),
      ).resolves.toBeDefined();
    });

    it('valida el estado FINAL: un PATCH que no toca consumos no falla', async () => {
      prisma.extra.findUnique.mockResolvedValue({
        id: 'x1',
        esGlobal: false,
        categoriasAplica: [{ categoriaId: 'c1' }],
        preciosPorCategoria: [],
        consumosPorCategoria: [{ categoriaId: 'c1', cantidadConsumo: 50 }],
        nombre: 'Cheddar',
        precio: 1,
        unidadMedida: 'u',
        stockActual: 1,
        stockMinimo: 1,
        activo: true,
        esPremium: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        insumo: null,
      });

      // El consumo de c1 ya estaba cargado: renombrar no tiene por que exigir
      // reenviarlo.
      await expect(
        service.editar('x1', { nombre: 'Cheddar nuevo' } as any),
      ).resolves.toBeDefined();
    });

    it('agregar una categoria por PATCH exige su consumo', async () => {
      prisma.extra.findUnique.mockResolvedValue({
        id: 'x1',
        esGlobal: false,
        categoriasAplica: [{ categoriaId: 'c1' }],
        preciosPorCategoria: [],
        consumosPorCategoria: [{ categoriaId: 'c1', cantidadConsumo: 50 }],
        nombre: 'Cheddar',
        precio: 1,
        unidadMedida: 'u',
        stockActual: 1,
        stockMinimo: 1,
        activo: true,
        esPremium: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        insumo: null,
      });

      // Suma c2 al alcance pero no manda su consumo: el set de consumos que
      // queda (el viejo) no la cubre.
      await expect(
        service.editar('x1', { categoriaIds: ['c1', 'c2'] } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('pasar a global por PATCH exige el consumo de las categorias nuevas', async () => {
      prisma.extra.findUnique.mockResolvedValue({
        id: 'x1',
        esGlobal: false,
        categoriasAplica: [{ categoriaId: 'c1' }],
        preciosPorCategoria: [],
        consumosPorCategoria: [{ categoriaId: 'c1', cantidadConsumo: 50 }],
        nombre: 'Cheddar',
        precio: 1,
        unidadMedida: 'u',
        stockActual: 1,
        stockMinimo: 1,
        activo: true,
        esPremium: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        insumo: null,
      });

      await expect(
        service.editar('x1', { esGlobal: true } as any),
      ).rejects.toThrow(/global/i);
    });

    it('vaciar los consumos con [] queda rechazado si el extra se ofrece', async () => {
      prisma.extra.findUnique.mockResolvedValue({
        id: 'x1',
        esGlobal: false,
        categoriasAplica: [{ categoriaId: 'c1' }],
        preciosPorCategoria: [],
        consumosPorCategoria: [{ categoriaId: 'c1', cantidadConsumo: 50 }],
        nombre: 'Cheddar',
        precio: 1,
        unidadMedida: 'u',
        stockActual: 1,
        stockMinimo: 1,
        activo: true,
        esPremium: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        insumo: null,
      });

      await expect(
        service.editar('x1', { consumos: [] } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ------------------------------------------------------------- historial

  describe('historial', () => {
    it('clampea el limit', async () => {
      const res = await service.historial('x1', 99999);
      expect(res.limit).toBe(200);
    });

    it('usa el default cuando no viene limit', async () => {
      const res = await service.historial('x1');
      expect(res.limit).toBe(50);
    });

    it('avisa cuando el extra descuenta de un insumo', async () => {
      prisma.extra.findUnique.mockResolvedValue({
        id: 'x3',
        nombre: 'Cheddar',
        unidadMedida: 'g',
        stockActual: 0,
        stockMinimo: 10,
        activo: true,
        insumo: { id: 'i1', nombre: 'Queso cheddar' },
      });

      const res = await service.historial('x3');

      // Sus movimientos se registran contra el insumo, no contra el extra: la
      // lista vacia tiene explicacion en vez de parecer un bug.
      expect(res.descuentaDelInsumo).toEqual({
        id: 'i1',
        nombre: 'Queso cheddar',
      });
      expect(res.movimientos).toEqual([]);
    });

    it('404 si el extra no existe', async () => {
      prisma.extra.findUnique.mockResolvedValue(null);
      await expect(service.historial('fantasma')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
