import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AdminAderezosService } from './admin-aderezos.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AlcanceAderezo,
  DisponibilidadAderezo,
  EstadoStockAderezo,
  OrdenAderezos,
} from './dto/admin-aderezos-query.dto';

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

describe('AdminAderezosService', () => {
  let service: AdminAderezosService;
  let prisma: any;
  let sqlEjecutado: string[];
  let parametros: any[][];
  let respuestas: Record<string, any[]>;

  const FILA = {
    id: 'a1',
    nombre: 'Mayonesa',
    unidadMedida: 'kg',
    stockActual: 1.5,
    stockMinimo: 6,
    activo: true,
    esGlobal: true,
    estado: 'BAJO',
    categorias: 0,
    consumos: 3,
    consumosFaltantes: 1,
    consumido: 14.7,
    movimientos: 21,
  };

  const CONTEOS = {
    total: 6,
    activos: 5,
    pausados: 1,
    ok: 3,
    bajo: 1,
    sinStock: 1,
    porReponer: 2,
    globales: 2,
    sinAlcance: 1,
    sinConsumoConfigurado: 2,
    sinUnidad: 0,
  };

  const CONSUMO_HEADER = {
    consumido: 42,
    descontado: 45,
    repuesto: 3,
    salsas: 4,
  };

  /** Clasifica una query por un pedazo de SQL que solo ella tiene. */
  function clasificar(sql: string): string {
    if (sql.includes('"sinConsumoConfigurado"')) return 'conteos';
    if (sql.includes('"salsas"')) return 'consumoHeader';
    if (
      sql.includes('JOIN consumo c ON c.id = a."id"') &&
      sql.includes('c.consumido > 0')
    )
      return 'agotan';
    if (
      sql.includes('FROM "AderezoCategoria" ac') &&
      sql.includes('JOIN pagina')
    )
      return 'categorias';
    if (sql.includes('AS total')) return 'total';
    if (sql.includes('OFFSET')) return 'pagina';
    return 'desconocida';
  }

  const ADEREZO_DETALLE = {
    id: 'a1',
    nombre: 'Mayonesa',
    unidadMedida: 'kg',
    stockActual: 1.5,
    stockMinimo: 6,
    activo: true,
    esGlobal: false,
    categoriasAplica: [{ categoriaId: 'c1' }],
    consumosPorCategoria: [{ categoriaId: 'c1', cantidadConsumo: 0.04 }],
  };

  beforeEach(async () => {
    sqlEjecutado = [];
    parametros = [];
    respuestas = {
      pagina: [FILA],
      total: [{ total: 1 }],
      conteos: [CONTEOS],
      consumoHeader: [CONSUMO_HEADER],
      agotan: [],
      categorias: [],
    };

    const queryRaw = jest.fn((strings: string[], ...valores: any[]) => {
      const sql = aplanar(Array.from(strings), valores);
      sqlEjecutado.push(sql);
      parametros.push(escalares(valores));
      return Promise.resolve(respuestas[clasificar(sql)] ?? []);
    });

    const tx = {
      aderezo: {
        create: jest.fn((a: any) =>
          Promise.resolve({ id: 'nuevo', ...a.data }),
        ),
        update: jest.fn((a: any) =>
          Promise.resolve({ id: a.where.id, ...a.data }),
        ),
        delete: jest.fn().mockResolvedValue({}),
      },
      aderezoCategoria: { deleteMany: jest.fn(), createMany: jest.fn() },
      aderezoConsumo: { deleteMany: jest.fn(), createMany: jest.fn() },
      stockMovimiento: { deleteMany: jest.fn(), create: jest.fn() },
    };

    prisma = {
      $queryRaw: queryRaw,
      $transaction: jest.fn((fn: any) => fn(tx)),
      __tx: tx,
      aderezo: {
        findUnique: jest.fn().mockResolvedValue({ ...ADEREZO_DETALLE }),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      categoria: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'c1',
            nombre: 'Hamburguesas',
            activo: true,
            sinExtrasNiAderezos: false,
          },
          {
            id: 'c2',
            nombre: 'Postres',
            activo: true,
            sinExtrasNiAderezos: true,
          },
        ]),
      },
      pedidoDetalle: { count: jest.fn().mockResolvedValue(0) },
      stockMovimiento: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAderezosService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AdminAderezosService);
  });

  const sqlDe = (clave: string) =>
    sqlEjecutado.find((sql) => clasificar(sql) === clave) ?? '';
  const paramsDe = (clave: string) =>
    parametros[sqlEjecutado.findIndex((sql) => clasificar(sql) === clave)] ??
    [];

  // ------------------------------------------------------------- listado

  describe('listar', () => {
    it('devuelve stats, seAgotan, items, paginacion, filtros y ventana', async () => {
      const res = await service.listar({}, AHORA);

      expect(res.stats.total).toBe(6);
      expect(res.stats.porReponer).toBe(2);
      expect(res.stats.sinConsumoConfigurado).toBe(2);
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

    it('la salud del stock se mide sobre las ACTIVAS, no sobre el total', async () => {
      // 3 ok de 5 activas = 60%. Sobre el total (6) daria 50% y contaria a una
      // pausada como si estuviera mal.
      const res = await service.listar({}, AHORA);
      expect(res.stats.pctOk).toBe(60);
    });

    it('el consumo del header se reparte por los dias de la ventana', async () => {
      const res = await service.listar({ dias: 7 }, AHORA);
      expect(res.stats.consumo.total).toBe(42);
      expect(res.stats.consumo.diario).toBe(6);
      expect(res.stats.consumo.ventanaDias).toBe(7);
    });

    it('por defecto muestra solo las activas', async () => {
      await service.listar({}, AHORA);
      expect(sqlDe('pagina')).toContain('a."activo" = true');
    });

    it('filtra por estado de stock contra el minimo DE LA SALSA', async () => {
      await service.listar({ estado: EstadoStockAderezo.POR_REPONER }, AHORA);
      expect(sqlDe('pagina')).toContain('a."stockActual" < a."stockMinimo"');
    });

    it('SIN_ALCANCE busca las que no se ofrecen en ningun lado', async () => {
      await service.listar({ alcance: AlcanceAderezo.SIN_ALCANCE }, AHORA);

      const sql = sqlDe('pagina');
      expect(sql).toContain('a."esGlobal" = false');
      expect(sql).toContain('NOT EXISTS');
    });

    it('filtrar por categoria incluye a las globales', async () => {
      await service.listar({ categoriaId: 'c1' }, AHORA);

      // Una salsa global se ofrece en todas las categorias: si el filtro solo
      // mirara AderezoCategoria, desapareceria de su propia categoria.
      const sql = sqlDe('pagina');
      expect(sql).toContain('a."esGlobal" = true');
      expect(paramsDe('pagina')).toContain('c1');
    });

    it('busca por nombre escapando los comodines del ILIKE', async () => {
      await service.listar({ q: '50%' }, AHORA);

      expect(sqlDe('pagina')).toContain('a."nombre" ILIKE');
      expect(paramsDe('pagina')).toContain('%50\\%%');
    });

    it('el orden AGUANTE manda al final a las que no tienen consumo', async () => {
      // Sin el NULLS LAST, una salsa sin movimientos encabezaria el ranking de
      // urgencia para siempre: division por null ordena primero.
      await service.listar({ orden: OrdenAderezos.AGUANTE }, AHORA);
      expect(sqlDe('pagina')).toContain('ASC NULLS LAST');
    });

    it('los ordenes desempatan por id para que la paginacion sea estable', async () => {
      for (const orden of Object.values(OrdenAderezos)) {
        sqlEjecutado = [];
        await service.listar({ orden }, AHORA);
        expect(sqlDe('pagina')).toContain('a."id" ASC');
      }
    });

    it('el aguante de un item sale de stock / consumo diario', async () => {
      // 14.7 consumidos en 7 dias = 2.1/dia; 1.5 de stock aguanta 0.71 dias.
      const res = await service.listar({}, AHORA);
      expect(res.items[0].consumo.diario).toBe(2.1);
      expect(res.items[0].consumo.diasDeAguante).toBe(0.71);
    });

    it('sin consumo medido, el aguante es null y NO infinito', async () => {
      respuestas.pagina = [{ ...FILA, consumido: 0, movimientos: 0 }];
      const res = await service.listar({}, AHORA);

      expect(res.items[0].consumo.diario).toBe(0);
      expect(res.items[0].consumo.diasDeAguante).toBeNull();
    });

    it('un item expone que es gratis y no trae ningun precio', async () => {
      const res = await service.listar({}, AHORA);
      expect(res.items[0].gratis).toBe(true);
      expect(res.items[0]).not.toHaveProperty('precio');
      expect(JSON.stringify(res)).not.toContain('precio');
    });

    it('marca las categorias donde la salsa descuenta 1 a ciegas', async () => {
      const res = await service.listar({}, AHORA);
      expect(res.items[0].configuracion.consumosFaltantes).toBe(1);
    });

    it('una salsa ni global ni con categorias queda marcada sinAlcance', async () => {
      respuestas.pagina = [{ ...FILA, esGlobal: false, categorias: 0 }];
      const res = await service.listar({}, AHORA);
      expect(res.items[0].alcance.sinAlcance).toBe(true);
    });

    it('"reponer primero" solo mira activas con consumo > 0', async () => {
      await service.listar({}, AHORA);
      const sql = sqlDe('agotan');
      expect(sql).toContain('a."activo"');
      expect(sql).toContain('c.consumido > 0');
    });

    it('el total de la paginacion sale de su propia query', async () => {
      // No de un COUNT(*) OVER (): ese devuelve cero filas con la pagina vacia,
      // y ahi el total se pierde justo cuando el front lo necesita.
      respuestas.pagina = [];
      respuestas.total = [{ total: 37 }];

      const res = await service.listar({ page: 99 }, AHORA);
      expect(res.items).toEqual([]);
      expect(res.paginacion.total).toBe(37);
    });

    it('pageSize se clampea aunque el DTO no haya corrido', async () => {
      const res = await service.listar({ pageSize: 9999 }, AHORA);
      expect(res.paginacion.pageSize).toBe(100);
    });

    it('la disponibilidad PAUSADOS invierte el filtro', async () => {
      await service.listar(
        { disponibilidad: DisponibilidadAderezo.PAUSADOS },
        AHORA,
      );
      expect(sqlDe('pagina')).toContain('a."activo" = false');
    });
  });

  // ------------------------------------------------------------- detalle

  describe('detalle', () => {
    it('404 si no existe', async () => {
      prisma.aderezo.findUnique.mockResolvedValue(null);
      await expect(service.detalle('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('devuelve una fila por categoria, con el consumo cargado o en default', async () => {
      const res = await service.detalle('a1');

      expect(res.categorias).toHaveLength(2);

      const hamburguesas = res.categorias.find((c) => c.categoriaId === 'c1')!;
      expect(hamburguesas.aplica).toBe(true);
      expect(hamburguesas.consumo).toBe(0.04);
      expect(hamburguesas.consumoEnDefault).toBe(false);
      expect(hamburguesas.consumoFaltante).toBe(false);

      const postres = res.categorias.find((c) => c.categoriaId === 'c2')!;
      expect(postres.aplica).toBe(false);
      expect(postres.consumo).toBeNull();
      // El 1 no es una decision de negocio: es el fallback de getAderezoConsumo.
      expect(postres.consumoEfectivo).toBe(1);
      expect(postres.consumoEnDefault).toBe(true);
      // No aplica, asi que no descuenta a ciegas: no es un faltante.
      expect(postres.consumoFaltante).toBe(false);
    });

    it('marca consumoFaltante donde SE OFRECE y no hay consumo cargado', async () => {
      prisma.aderezo.findUnique.mockResolvedValue({
        ...ADEREZO_DETALLE,
        esGlobal: true,
        consumosPorCategoria: [],
      });

      const res = await service.detalle('a1');
      expect(res.resumen.consumosFaltantes).toBe(2);
      expect(res.categorias.every((c) => c.consumoFaltante)).toBe(true);
    });

    it('dice cuando la categoria no admite aderezos', async () => {
      const res = await service.detalle('a1');
      expect(
        res.categorias.find((c) => c.categoriaId === 'c2')!.admiteAderezos,
      ).toBe(false);
    });

    it('la ficha NO trae precio y dice explicitamente que es gratis', async () => {
      const res = await service.detalle('a1');
      expect(res.gratis).toBe(true);
      expect(res).not.toHaveProperty('precio');
      expect(JSON.stringify(res)).not.toContain('precio');
    });

    it('pide TODAS las categorias, no solo las activas', async () => {
      // Si devolviera solo las activas, desactivar una categoria dejaria a la
      // salsa ineditable: el form no tendria donde cargar el consumo que la
      // validacion le va a exigir.
      await service.detalle('a1');
      expect(prisma.categoria.findMany).toHaveBeenCalledWith(
        expect.not.objectContaining({ where: expect.anything() }),
      );
    });
  });

  // ------------------------------------------------------------- escritura

  describe('crear', () => {
    const base = {
      nombre: 'Alioli',
      unidadMedida: 'kg',
      stockMinimo: 2,
    };

    it('arranca en stock 0 y NO en 999', async () => {
      await service.crear({ ...base });
      expect(prisma.__tx.aderezo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ stockActual: 0 }),
        }),
      );
    });

    it('respeta el stock inicial cuando viene', async () => {
      await service.crear({ ...base, stockActual: 12.5 });
      expect(prisma.__tx.aderezo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ stockActual: 12.5 }),
        }),
      );
    });

    it('no escribe ningun precio', async () => {
      await service.crear({ ...base });
      const data = prisma.__tx.aderezo.create.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('precio');
    });

    it('409 si el nombre ya existe (case-insensitive)', async () => {
      prisma.aderezo.findFirst.mockResolvedValue({
        id: 'otro',
        nombre: 'Alioli',
        activo: true,
      });
      await expect(service.crear({ ...base })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('el 409 de una pausada invita a reactivarla', async () => {
      prisma.aderezo.findFirst.mockResolvedValue({
        id: 'otro',
        nombre: 'Alioli',
        activo: false,
      });
      await expect(service.crear({ ...base })).rejects.toThrow(/pausada/i);
    });

    it('400 si una categoriaId no existe', async () => {
      // Sin esto sale como P2003 y el filtro global lo vuelve un 500 mudo.
      prisma.categoria.findMany.mockResolvedValue([]);
      await expect(
        service.crear({ ...base, categoriaIds: ['fantasma'] }),
      ).rejects.toThrow(/no existen/i);
    });

    it('400 si se ofrece en una categoria sin decir cuanto descuenta', async () => {
      await expect(
        service.crear({ ...base, categoriaIds: ['c1'], consumos: [] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('una salsa global necesita el consumo en TODAS las categorias', async () => {
      await expect(
        service.crear({
          ...base,
          esGlobal: true,
          consumos: [{ categoriaId: 'c1', cantidadConsumo: 0.04 }],
        }),
      ).rejects.toThrow(/global/i);
    });

    it('acepta el alta completa y guarda alcance y consumo en la transaccion', async () => {
      await service.crear({
        ...base,
        categoriaIds: ['c1'],
        consumos: [{ categoriaId: 'c1', cantidadConsumo: 0.04 }],
      });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.__tx.aderezoCategoria.createMany).toHaveBeenCalled();
      expect(prisma.__tx.aderezoConsumo.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            { aderezoId: 'nuevo', categoriaId: 'c1', cantidadConsumo: 0.04 },
          ],
        }),
      );
    });

    it('un consumo en 0 no cuenta como configurado ni aunque no pase por el DTO', async () => {
      await expect(
        service.crear({
          ...base,
          categoriaIds: ['c1'],
          consumos: [{ categoriaId: 'c1', cantidadConsumo: 0 }],
        }),
      ).rejects.toThrow(/mayor a 0/i);
    });
  });

  describe('editar', () => {
    it('404 si no existe', async () => {
      prisma.aderezo.findUnique.mockResolvedValue(null);
      await expect(service.editar('nope', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('un PATCH que solo cambia el nombre no exige consumos', async () => {
      // La validacion corre sobre el ESTADO FINAL, no sobre el body: si mirara
      // el body, editar el nombre fallaria por no mandar consumos.
      prisma.aderezo.findUnique.mockResolvedValue({
        ...ADEREZO_DETALLE,
        categoriasAplica: [{ categoriaId: 'c1' }],
        consumosPorCategoria: [{ categoriaId: 'c1', cantidadConsumo: 0.04 }],
      });

      await expect(
        service.editar('a1', { nombre: 'Mayonesa casera' }),
      ).resolves.toBeDefined();
    });

    it('agregar una categoria sin su consumo se rechaza', async () => {
      await expect(
        service.editar('a1', { categoriaIds: ['c1', 'c2'] }),
      ).rejects.toThrow(/Falta el consumo/i);
    });

    it('los bloques son reemplazo completo: [] borra', async () => {
      await service.editar('a1', { categoriaIds: [], consumos: [] });
      expect(prisma.__tx.aderezoCategoria.deleteMany).toHaveBeenCalledWith({
        where: { aderezoId: 'a1' },
      });
      expect(prisma.__tx.aderezoCategoria.createMany).not.toHaveBeenCalled();
    });

    it('omitir un bloque lo deja como estaba', async () => {
      await service.editar('a1', { nombre: 'Otra' });
      expect(prisma.__tx.aderezoCategoria.deleteMany).not.toHaveBeenCalled();
      expect(prisma.__tx.aderezoConsumo.deleteMany).not.toHaveBeenCalled();
    });

    it('un cambio de stock deja su movimiento de auditoria', async () => {
      await service.editar('a1', { stockActual: 10 });
      expect(prisma.__tx.stockMovimiento.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            aderezoId: 'a1',
            tipo: 'AJUSTE_MANUAL',
            stockAntes: 1.5,
            stockDespues: 10,
            cantidad: 8.5,
          }),
        }),
      );
    });

    it('mandar el mismo stock no inventa un movimiento', async () => {
      await service.editar('a1', { stockActual: 1.5 });
      expect(prisma.__tx.stockMovimiento.create).not.toHaveBeenCalled();
    });
  });

  describe('eliminar', () => {
    it('400 si la salsa ya se uso en un pedido', async () => {
      // ⚠️ Este guard NO es cortesia: la relacion con PedidoDetalle es m2m con
      // ON DELETE CASCADE, asi que sin el chequeo el DELETE no falla, se lleva
      // puesto en silencio que esos pedidos llevaban esta salsa.
      prisma.pedidoDetalle.count.mockResolvedValue(1);

      await expect(service.eliminar('a1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.eliminar('a1')).rejects.toThrow(/Pausala/i);
      expect(prisma.__tx.aderezo.delete).not.toHaveBeenCalled();
    });

    it('el guard pregunta por el uso en pedidos, no por los movimientos', async () => {
      await service.eliminar('a1');
      expect(prisma.pedidoDetalle.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { aderezos: { some: { id: 'a1' } } },
        }),
      );
    });

    it('si nunca se uso, borra tambien sus movimientos y su configuracion', async () => {
      // Los movimientos se borran porque el FK es SET NULL: sobrevivirian como
      // filas sin dueño, invisibles para todo historial.
      const res = await service.eliminar('a1');

      expect(prisma.__tx.stockMovimiento.deleteMany).toHaveBeenCalledWith({
        where: { aderezoId: 'a1' },
      });
      expect(prisma.__tx.aderezoConsumo.deleteMany).toHaveBeenCalled();
      expect(prisma.__tx.aderezoCategoria.deleteMany).toHaveBeenCalled();
      expect(prisma.__tx.aderezo.delete).toHaveBeenCalledWith({
        where: { id: 'a1' },
      });
      expect(res).toEqual({ ok: true, id: 'a1' });
    });

    it('404 si no existe', async () => {
      prisma.aderezo.findUnique.mockResolvedValue(null);
      await expect(service.eliminar('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ------------------------------------------------------------- historial

  describe('historial', () => {
    it('404 si la salsa no existe', async () => {
      prisma.aderezo.findUnique.mockResolvedValue(null);
      await expect(service.historial('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('clampea el limit al techo (el endpoint viejo no tenia)', async () => {
      const res = await service.historial('a1', 999999);
      expect(res.limit).toBe(200);
      expect(prisma.stockMovimiento.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
    });

    it('un limit menor a 1 cae al piso', async () => {
      const res = await service.historial('a1', 0);
      expect(res.limit).toBe(1);
    });

    it('sin limit usa el default de 50', async () => {
      const res = await service.historial('a1');
      expect(res.limit).toBe(50);
    });

    it('devuelve el total real, que dice si el limit recorto', async () => {
      prisma.stockMovimiento.count.mockResolvedValue(412);
      const res = await service.historial('a1', 10);
      expect(res.total).toBe(412);
      expect(res.limit).toBe(10);
    });

    it('trae los movimientos con antes → despues, motivo, tipo y fecha', async () => {
      const creado = new Date('2026-08-27T18:00:00Z');
      prisma.stockMovimiento.findMany.mockResolvedValue([
        {
          id: 'm1',
          tipo: 'DESCUENTO_PEDIDO',
          cantidad: -0.08,
          stockAntes: 1.58,
          stockDespues: 1.5,
          motivo: 'Consumo por aderezo: Mayonesa',
          pedidoId: 'p1',
          createdAt: creado,
        },
      ]);

      const res = await service.historial('a1');
      expect(res.movimientos[0]).toEqual({
        id: 'm1',
        tipo: 'DESCUENTO_PEDIDO',
        cantidad: -0.08,
        stockAntes: 1.58,
        stockDespues: 1.5,
        motivo: 'Consumo por aderezo: Mayonesa',
        pedidoId: 'p1',
        createdAt: creado,
      });
      expect(res.aderezo.estado).toBe('BAJO');
    });
  });

  // ------------------------------------------------------------- setActivo

  describe('setActivo', () => {
    it('pausa sin tocar nada mas', async () => {
      await service.setActivo('a1', false);
      expect(prisma.aderezo.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { activo: false },
      });
    });

    it('404 si no existe', async () => {
      prisma.aderezo.findUnique.mockResolvedValue(null);
      await expect(service.setActivo('nope', true)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
