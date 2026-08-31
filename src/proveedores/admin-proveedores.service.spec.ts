import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';

import { AdminProveedoresService } from './admin-proveedores.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  EstadoProveedor,
  OrdenProveedores,
} from './dto/admin-proveedores-query.dto';

/**
 * Las queries crudas del service se distinguen por su SQL, asi que el mock
 * rutea por contenido y no por orden de llamada: si manana cambia el orden del
 * `Promise.all`, los tests no se dan vuelta solos.
 *
 * Los fragmentos `Prisma.sql` (los CTE, el WHERE, el ORDER BY, el CASE del
 * estado) NO viajan en el template: llegan como valor interpolado, asi que hay
 * que pegarlos a mano para reconstruir la query completa.
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

describe('AdminProveedoresService', () => {
  let service: AdminProveedoresService;
  let prisma: any;
  let sqlEjecutado: string[];
  let parametros: any[][];
  let respuestas: Record<string, any[]>;

  const FILA = {
    id: 'p1',
    nombre: 'Lacteos SR',
    telefono: '341 555 0088',
    email: 'ventas@lacteossr.com',
    notas: 'Hablar con Ruben.',
    activo: true,
    insumos: 3,
    insumosActivos: 3,
    bajoMinimo: 2,
    sinStock: 1,
    compraSugerida: 21.5,
    ultimaReposicionFecha: new Date('2026-08-24T18:30:00.000Z'),
    ultimaReposicionCantidad: 4,
    ultimaReposicionInsumo: 'Muzzarella',
  };

  const CONTEOS = {
    total: 4,
    activos: 3,
    archivados: 1,
    aLlamar: 2,
    sinTelefono: 1,
    sinInsumos: 0,
  };

  const COBERTURA = {
    insumos: 9,
    conProveedor: 7,
    sinProveedor: 2,
    bajoMinimo: 3,
    bajoMinimoSinProveedor: 1,
    compraSugeridaTotal: 91.5,
  };

  /** Clasifica una query por un pedazo de SQL que solo ella tiene. */
  function clasificar(sql: string): string {
    if (sql.includes('"sinTelefono"')) return 'conteos';
    if (sql.includes('"bajoMinimoSinProveedor"')) return 'cobertura';
    if (sql.includes('"provBajoMinimo"')) return 'aLlamar';
    if (sql.includes('COALESCE(a."insumos", 0) > 0')) return 'ranking';
    if (sql.includes('AS total')) return 'total';
    if (sql.includes('OFFSET')) return 'pagina';
    if (sql.includes('LIMIT 1')) return 'reposicion';
    if (sql.includes('GREATEST(i."stockMinimo", 1)')) return 'insumosProveedor';
    return 'desconocida';
  }

  beforeEach(async () => {
    sqlEjecutado = [];
    parametros = [];
    respuestas = {
      pagina: [FILA],
      total: [{ total: 1 }],
      conteos: [CONTEOS],
      cobertura: [COBERTURA],
      aLlamar: [],
      ranking: [],
      insumosProveedor: [],
      reposicion: [],
    };

    const queryRaw = jest.fn((strings: string[], ...valores: any[]) => {
      const sql = aplanar(Array.from(strings), valores);
      sqlEjecutado.push(sql);
      parametros.push(escalares(valores));
      return Promise.resolve(respuestas[clasificar(sql)] ?? []);
    });

    prisma = {
      $queryRaw: queryRaw,
      proveedor: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn((args: any) => Promise.resolve({ id: 'nuevo', ...args.data })),
        update: jest.fn((args: any) =>
          Promise.resolve({ id: args.where.id, ...args.data }),
        ),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminProveedoresService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AdminProveedoresService);
  });

  const sqlDe = (clave: string) =>
    sqlEjecutado.find((sql) => clasificar(sql) === clave) ?? '';

  const paramsDe = (clave: string) =>
    parametros[sqlEjecutado.findIndex((sql) => clasificar(sql) === clave)] ?? [];

  // ------------------------------------------------------------- listado

  describe('listar', () => {
    it('devuelve stats, aLlamar, ranking, items, paginacion y filtros', async () => {
      const res = await service.listar({});

      expect(res.stats.total).toBe(4);
      expect(res.stats.archivados).toBe(1);
      expect(res.stats.aLlamar).toBe(2);
      expect(res.stats.cobertura.sinProveedor).toBe(2);
      expect(res.stats.cobertura.compraSugeridaTotal).toBe(91.5);
      expect(res.paginacion).toEqual({
        page: 1,
        pageSize: 24,
        total: 1,
        totalPaginas: 1,
      });
      expect(res.filtros).toEqual({
        q: null,
        estado: EstadoProveedor.ACTIVOS,
        orden: OrdenProveedores.POR_LLAMAR,
      });
    });

    it('por defecto lista SOLO activos', async () => {
      await service.listar({});

      expect(sqlDe('pagina')).toContain('p."activo" = true');
    });

    it('con estado=ARCHIVADOS lista solo los dados de baja', async () => {
      await service.listar({ estado: EstadoProveedor.ARCHIVADOS });

      expect(sqlDe('pagina')).toContain('p."activo" = false');
    });

    it('con estado=TODOS no filtra por activo', async () => {
      await service.listar({ estado: EstadoProveedor.TODOS });

      expect(sqlDe('pagina')).not.toContain('p."activo" =');
    });

    it('incluirArchivados=true equivale a estado=TODOS', async () => {
      const res = await service.listar({ incluirArchivados: true });

      expect(res.filtros.estado).toBe(EstadoProveedor.TODOS);
      expect(sqlDe('pagina')).not.toContain('p."activo" =');
    });

    it('si vienen los dos, estado explicito le gana al atajo', async () => {
      const res = await service.listar({
        incluirArchivados: true,
        estado: EstadoProveedor.ACTIVOS,
      });

      expect(res.filtros.estado).toBe(EstadoProveedor.ACTIVOS);
      expect(sqlDe('pagina')).toContain('p."activo" = true');
    });

    it('busca por nombre escapando los comodines del ILIKE', async () => {
      await service.listar({ q: '50%' });

      expect(sqlDe('pagina')).toContain('p."nombre" ILIKE');
      expect(paramsDe('pagina')).toContain('%50\\%%');
    });

    it('ordena por "a quien llamar" por defecto y respeta el orden pedido', async () => {
      await service.listar({});
      expect(sqlDe('pagina')).toContain('COALESCE(a."bajoMinimo", 0) DESC');

      sqlEjecutado = [];
      parametros = [];
      await service.listar({ orden: OrdenProveedores.ALFABETICO });
      expect(sqlDe('pagina')).not.toContain('COALESCE(a."bajoMinimo", 0) DESC');
      expect(sqlDe('pagina')).toContain('p."nombre" ASC');
    });

    it('clampea el pageSize al maximo', async () => {
      const res = await service.listar({ pageSize: 5000 });

      expect(res.paginacion.pageSize).toBe(100);
      expect(paramsDe('pagina')).toContain(100);
    });

    it('los conteos del header NO se filtran por la busqueda', async () => {
      await service.listar({ q: 'lacteos', estado: EstadoProveedor.ARCHIVADOS });

      // El WHERE del listado no tiene por que aparecer en los conteos: las
      // tarjetas describen el padron entero, no el resultado de la busqueda.
      expect(sqlDe('conteos')).not.toContain('ILIKE');
      expect(sqlDe('conteos')).not.toContain('p."activo" = false');
    });

    it('compone el item con los agregados que calculo Postgres', async () => {
      const [item] = (await service.listar({})).items;

      expect(item.insumos).toBe(3);
      expect(item.bajoMinimo).toBe(2);
      expect(item.sinStock).toBe(1);
      expect(item.compraSugerida).toBe(21.5);
      expect(item.ultimaReposicion).toEqual({
        fecha: '2026-08-24T18:30:00.000Z',
        cantidad: 4,
        insumo: 'Muzzarella',
      });
    });

    it('deja la ultima reposicion en null cuando el proveedor no tiene ninguna', async () => {
      respuestas.pagina = [
        {
          ...FILA,
          ultimaReposicionFecha: null,
          ultimaReposicionCantidad: null,
          ultimaReposicionInsumo: null,
        },
      ];

      const [item] = (await service.listar({})).items;

      // null y no una fecha inventada ni un 0: no es "hace mucho", es que no
      // hay con que contestar la pregunta.
      expect(item.ultimaReposicion).toBeNull();
    });

    it('deriva la ultima reposicion de los movimientos REPOSICION', async () => {
      await service.listar({});

      expect(sqlDe('pagina')).toContain(`m."tipo" = 'REPOSICION'`);
    });
  });

  // ------------------------------------------------- "hay que llamar a"

  describe('hay que llamar a', () => {
    it('agrupa los faltantes por proveedor sin reordenarlos', async () => {
      respuestas.aLlamar = [
        {
          proveedorId: 'p1',
          proveedorNombre: 'Distribuidora Norte',
          proveedorTelefono: '341 555 0142',
          provBajoMinimo: 2,
          provSinStock: 1,
          provCompraSugerida: 133,
          id: 'i3',
          nombre: 'Pan de hamburguesa',
          unidadMedida: 'u',
          activo: true,
          stockActual: 0,
          stockMinimo: 60,
          estado: 'SIN_STOCK',
          compraSugerida: 120,
        },
        {
          proveedorId: 'p1',
          proveedorNombre: 'Distribuidora Norte',
          proveedorTelefono: '341 555 0142',
          provBajoMinimo: 2,
          provSinStock: 1,
          provCompraSugerida: 133,
          id: 'i2',
          nombre: 'Carne picada',
          unidadMedida: 'kg',
          activo: true,
          stockActual: 7,
          stockMinimo: 10,
          estado: 'BAJO',
          compraSugerida: 13,
        },
        {
          proveedorId: 'p2',
          proveedorNombre: 'Lacteos SR',
          proveedorTelefono: null,
          provBajoMinimo: 1,
          provSinStock: 0,
          provCompraSugerida: 13,
          id: 'i1',
          nombre: 'Muzzarella',
          unidadMedida: 'kg',
          activo: true,
          stockActual: 3,
          stockMinimo: 8,
          estado: 'BAJO',
          compraSugerida: 13,
        },
      ];

      const { aLlamar } = await service.listar({});

      expect(aLlamar).toHaveLength(2);
      expect(aLlamar[0]).toMatchObject({
        id: 'p1',
        nombre: 'Distribuidora Norte',
        bajoMinimo: 2,
        sinStock: 1,
        compraSugerida: 133,
      });
      expect(aLlamar[0].items.map((i) => i.nombre)).toEqual([
        'Pan de hamburguesa',
        'Carne picada',
      ]);
      expect(aLlamar[1].id).toBe('p2');
      expect(aLlamar[1].items).toHaveLength(1);
    });

    it('solo mira proveedores activos y usa el "bajo minimo" de Insumos', async () => {
      await service.listar({});

      const sql = sqlDe('aLlamar');
      expect(sql).toContain('p."activo" = true');
      expect(sql).toContain('i."stockActual" < i."stockMinimo"');
      // El corte del top va antes del join con los faltantes, para que ningun
      // proveedor entre con la lista de insumos cortada por la mitad.
      expect(sql.indexOf('LIMIT')).toBeLessThan(sql.indexOf('JOIN faltantes f'));
    });
  });

  // ------------------------------------------------------------- detalle

  describe('detalle', () => {
    const PROVEEDOR = {
      id: 'p1',
      nombre: 'Lacteos SR',
      telefono: '341 555 0088',
      email: null,
      notas: null,
      activo: true,
      createdAt: new Date('2026-01-02T10:00:00.000Z'),
      updatedAt: new Date('2026-08-20T10:00:00.000Z'),
    };

    beforeEach(() => {
      prisma.proveedor.findUnique.mockResolvedValue(PROVEEDOR);
      respuestas.insumosProveedor = [
        {
          id: 'i1',
          nombre: 'Muzzarella',
          unidadMedida: 'kg',
          activo: true,
          stockActual: 3,
          stockMinimo: 8,
          estado: 'BAJO',
          compraSugerida: 13,
        },
        {
          id: 'i2',
          nombre: 'Crema de leche',
          unidadMedida: 'l',
          activo: true,
          stockActual: 0,
          stockMinimo: 4,
          estado: 'SIN_STOCK',
          compraSugerida: 8,
        },
        {
          id: 'i3',
          nombre: 'Manteca',
          unidadMedida: 'kg',
          activo: true,
          stockActual: 9,
          stockMinimo: 4,
          estado: 'OK',
          compraSugerida: 0,
        },
        {
          id: 'i4',
          nombre: 'Ricota',
          unidadMedida: 'kg',
          activo: false,
          stockActual: 0,
          stockMinimo: 3,
          estado: 'PAUSADO',
          compraSugerida: 6,
        },
      ];
    });

    it('404 si el proveedor no existe', async () => {
      prisma.proveedor.findUnique.mockResolvedValue(null);

      await expect(service.detalle('fantasma')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('trae TODOS los insumos vinculados, pausados incluidos', async () => {
      const res = await service.detalle('p1');

      expect(res.insumos).toHaveLength(4);
      expect(res.resumen.insumos).toBe(4);
      expect(res.resumen.insumosActivos).toBe(3);
    });

    it('el pedido sugerido solo lleva lo que esta bajo minimo y en juego', async () => {
      const res = await service.detalle('p1');

      // El OK no entra porque no hace falta comprarlo, y el PAUSADO tampoco
      // aunque este en cero: esta fuera de juego, igual que en Insumos.
      expect(res.pedidoSugerido.items.map((i) => i.nombre)).toEqual([
        'Muzzarella',
        'Crema de leche',
      ]);
      expect(res.pedidoSugerido.totalItems).toBe(2);
      expect(res.resumen.bajoMinimo).toBe(2);
      expect(res.resumen.sinStock).toBe(1);
      expect(res.resumen.compraSugerida).toBe(21);
    });

    it('arma el texto para copiar con la compra sugerida de cada item', async () => {
      const res = await service.detalle('p1');

      expect(res.pedidoSugerido.texto).toBe(
        'Muzzarella: 13 kg\nCrema de leche: 8 l',
      );
    });

    it('devuelve la ultima reposicion cuando hay, y null cuando no', async () => {
      respuestas.reposicion = [
        {
          fecha: new Date('2026-08-24T18:30:00.000Z'),
          cantidad: 4,
          insumo: 'Muzzarella',
        },
      ];
      expect((await service.detalle('p1')).ultimaReposicion).toEqual({
        fecha: '2026-08-24T18:30:00.000Z',
        cantidad: 4,
        insumo: 'Muzzarella',
      });

      respuestas.reposicion = [];
      expect((await service.detalle('p1')).ultimaReposicion).toBeNull();
    });
  });

  // ------------------------------------------------------------- escritura

  describe('crear', () => {
    it('crea activo y con los campos vacios en null', async () => {
      await service.crear({ nombre: 'Nuevo' });

      expect(prisma.proveedor.create).toHaveBeenCalledWith({
        data: {
          nombre: 'Nuevo',
          telefono: null,
          email: null,
          notas: null,
          activo: true,
        },
      });
    });

    it('rechaza un nombre repetido con 409 y no con un 500 de Prisma', async () => {
      prisma.proveedor.findFirst.mockResolvedValue({
        id: 'p9',
        nombre: 'Lacteos SR',
        activo: true,
      });

      await expect(service.crear({ nombre: 'lacteos sr' })).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.proveedor.create).not.toHaveBeenCalled();
    });

    it('compara el nombre sin distinguir mayusculas', async () => {
      await service.crear({ nombre: 'Nuevo' });

      expect(prisma.proveedor.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            nombre: { equals: 'Nuevo', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('recorta el nombre aunque no haya pasado por el ValidationPipe', async () => {
      // El service esta exportado: la unicidad no puede depender de que quien
      // llame haya pasado por el pipe que aplica el @Transform del DTO.
      await service.crear({ nombre: '  Norte  ' });

      expect(prisma.proveedor.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            nombre: { equals: 'Norte', mode: 'insensitive' },
          }),
        }),
      );
      expect(prisma.proveedor.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ nombre: 'Norte' }),
        }),
      );
    });

    it('traduce el P2002 de una carrera a 409 y no a un 500', async () => {
      // El findFirst es un check-then-act: dos altas simultaneas con el mismo
      // nombre pasan las dos y la segunda choca contra el UNIQUE.
      prisma.proveedor.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(service.crear({ nombre: 'Norte' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('si el que choca esta archivado, lo dice para que lo reactiven', async () => {
      prisma.proveedor.findFirst.mockResolvedValue({
        id: 'p9',
        nombre: 'Panaderia del Puerto',
        activo: false,
      });

      await expect(
        service.crear({ nombre: 'Panaderia del Puerto' }),
      ).rejects.toThrow(/archivado/i);
    });
  });

  describe('editar', () => {
    beforeEach(() => {
      prisma.proveedor.findUnique.mockResolvedValue({ id: 'p1' });
    });

    it('404 si no existe', async () => {
      prisma.proveedor.findUnique.mockResolvedValue(null);

      await expect(service.editar('fantasma', { nombre: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('un campo en null borra el dato y uno ausente lo deja como estaba', async () => {
      await service.editar('p1', { telefono: null });

      expect(prisma.proveedor.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: {
          nombre: undefined,
          telefono: null,
          email: undefined,
          notas: undefined,
        },
      });
    });

    it('no toca `activo`: para eso estan archivar y reactivar', async () => {
      await service.editar('p1', { nombre: 'Otro' });

      const { data } = prisma.proveedor.update.mock.calls[0][0];
      expect(data).not.toHaveProperty('activo');
    });

    it('al chequear el nombre repetido se ignora a si mismo', async () => {
      await service.editar('p1', { nombre: 'Lacteos SR' });

      expect(prisma.proveedor.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 'p1' } }),
        }),
      );
    });

    it('no chequea nombre si el PATCH no lo trae', async () => {
      await service.editar('p1', { notas: 'nueva nota' });

      expect(prisma.proveedor.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('archivar / reactivar', () => {
    beforeEach(() => {
      prisma.proveedor.findUnique.mockResolvedValue({ id: 'p1' });
    });

    it('archivar solo apaga el flag: no borra ni desasigna insumos', async () => {
      await service.archivar('p1');

      expect(prisma.proveedor.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { activo: false },
      });
      // Lo importante es lo que NO pasa: ningun update sobre Insumo, ningun
      // delete. El vinculo insumo → proveedor sobrevive al archivado.
      expect(prisma.proveedor.update).toHaveBeenCalledTimes(1);
    });

    it('reactivar vuelve a prenderlo', async () => {
      await service.reactivar('p1');

      expect(prisma.proveedor.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { activo: true },
      });
    });

    it('404 si no existe', async () => {
      prisma.proveedor.findUnique.mockResolvedValue(null);

      await expect(service.archivar('fantasma')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.reactivar('fantasma')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
