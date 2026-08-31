import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ProductosService } from './productos.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ProductosService', () => {
  let service: ProductosService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      producto: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ id: 'p1' }),
        create: jest.fn().mockResolvedValue({ id: 'p1' }),
        update: jest.fn().mockResolvedValue({ id: 'p1' }),
      },
      categoria: { findUnique: jest.fn().mockResolvedValue({ id: 'c1' }) },
      insumo: { findMany: jest.fn().mockResolvedValue([]) },
      productoReceta: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductosService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ProductosService>(ProductosService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  /**
   * El fix: GET /productos era @Public() y devolvia el producto entero con la
   * receta y el stock de cada insumo. Lo que sale ahora es solo lo que el menu
   * necesita para pintarse.
   */
  describe('obtenerMenuPublico', () => {
    const PRODUCTO_CRUDO = {
      id: 'p1',
      nombre: 'Doble cheddar',
      precio: 9500,
      descripcion: 'La clasica',
      imagenUrl: 'https://res.cloudinary.com/x.jpg',
      activo: true,
      categoriaId: 'c1',
      categoria: { id: 'c1', nombre: 'Hamburguesas', orden: 1 },
      receta: [{ cantidad: 2, insumo: { stockActual: 9 } }],
    };

    it('no devuelve receta, ni stock, ni codigo interno', async () => {
      prisma.producto.findMany.mockResolvedValue([PRODUCTO_CRUDO]);

      const [producto] = await service.obtenerMenuPublico();

      expect(producto).not.toHaveProperty('receta');
      expect(producto).not.toHaveProperty('codigo');
      expect(JSON.stringify(producto)).not.toContain('stockActual');
    });

    it('mantiene los campos que consume el menu', async () => {
      prisma.producto.findMany.mockResolvedValue([PRODUCTO_CRUDO]);

      const [producto] = await service.obtenerMenuPublico();

      expect(producto).toMatchObject({
        id: 'p1',
        nombre: 'Doble cheddar',
        precio: 9500,
        descripcion: 'La clasica',
        imagenUrl: 'https://res.cloudinary.com/x.jpg',
        activo: true,
        categoriaId: 'c1',
        categoria: { id: 'c1', nombre: 'Hamburguesas' },
      });
    });

    it('reemplaza el calculo de stock del cliente por un booleano', async () => {
      prisma.producto.findMany.mockResolvedValue([PRODUCTO_CRUDO]);

      const [producto] = await service.obtenerMenuPublico();

      // 9 unidades de un insumo que se consume de a 2 => 4 hamburguesas.
      expect(producto).toMatchObject({ disponible: true, unidadesPosibles: 4 });
    });

    it('nunca incluye pausados, aunque el cliente pida lo contrario', async () => {
      await service.obtenerMenuPublico();

      expect(prisma.producto.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { activo: true } }),
      );
    });
  });

  describe('obtenerMenuCompleto', () => {
    it('trae receta con insumo y respeta incluirInactivos', async () => {
      await service.obtenerMenuCompleto(true);

      const args = prisma.producto.findMany.mock.calls[0][0];
      expect(args.where).toEqual({});
      expect(args.include).toEqual({
        categoria: true,
        receta: { include: { insumo: true } },
      });
    });

    it('por defecto deja afuera los pausados', async () => {
      await service.obtenerMenuCompleto();

      expect(prisma.producto.findMany.mock.calls[0][0].where).toEqual({
        activo: true,
      });
    });
  });

  /**
   * Un insumo repetido en la receta pasaba derecho y la venta lo descontaba
   * dos veces (la venta recorre la receta linea por linea). Ahora lo corta la
   * base con la unique, pero el 400 explicito es el que dice cual insumo es.
   */
  describe('validacion de la receta', () => {
    it('rechaza el mismo insumo dos veces y no toca la base', async () => {
      await expect(
        service.crearProductoConReceta({
          nombre: 'Doble',
          precio: 9500,
          categoriaId: 'c1',
          receta: [
            { insumoId: 'i1', cantidad: 1 },
            { insumoId: 'i1', cantidad: 2 },
          ],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.producto.create).not.toHaveBeenCalled();
    });

    it('rechaza cantidades que no son mayores a cero', async () => {
      await expect(
        service.crearProductoConReceta({
          nombre: 'Doble',
          precio: 9500,
          categoriaId: 'c1',
          receta: [{ insumoId: 'i1', cantidad: -3 }],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.producto.create).not.toHaveBeenCalled();
    });

    it('rechaza insumos inexistentes en vez de reventar por foreign key', async () => {
      prisma.insumo.findMany.mockResolvedValue([{ id: 'i1' }]);

      await expect(
        service.crearProductoConReceta({
          nombre: 'Doble',
          precio: 9500,
          categoriaId: 'c1',
          receta: [
            { insumoId: 'i1', cantidad: 1 },
            { insumoId: 'fantasma', cantidad: 1 },
          ],
        } as any),
      ).rejects.toThrow(/fantasma/);

      expect(prisma.producto.create).not.toHaveBeenCalled();
    });

    it('con la receta valida crea el producto', async () => {
      prisma.insumo.findMany.mockResolvedValue([{ id: 'i1' }, { id: 'i2' }]);

      await service.crearProductoConReceta({
        nombre: '  Doble  ',
        precio: 9500,
        categoriaId: 'c1',
        receta: [
          { insumoId: 'i1', cantidad: 1 },
          { insumoId: 'i2', cantidad: 0.25 },
        ],
      } as any);

      const data = prisma.producto.create.mock.calls[0][0].data;
      expect(data.nombre).toBe('Doble');
      expect(data.receta.create).toEqual([
        { insumoId: 'i1', cantidad: 1 },
        { insumoId: 'i2', cantidad: 0.25 },
      ]);
    });

    it('en update valida antes de abrir la transaccion', async () => {
      await expect(
        service.update('p1', {
          receta: [
            { insumoId: 'i1', cantidad: 1 },
            { insumoId: 'i1', cantidad: 1 },
          ],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
