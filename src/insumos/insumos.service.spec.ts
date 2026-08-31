import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AdminInsumosService } from './admin-insumos.service';
import { InsumosService } from './insumos.service';
import { PrismaService } from '../prisma/prisma.service';

describe('InsumosService', () => {
  let service: InsumosService;
  let prisma: any;
  let adminInsumos: any;
  /** Lo que se escribio en el ledger durante el test. */
  let movimientos: any[];

  beforeEach(async () => {
    movimientos = [];

    const tx = {
      insumo: {
        create: jest.fn((args: any) =>
          Promise.resolve({ id: 'i1', ...args.data }),
        ),
        update: jest.fn((args: any) =>
          Promise.resolve({ id: 'i1', ...args.data }),
        ),
      },
      stockMovimiento: {
        create: jest.fn((args: any) => {
          movimientos.push(args.data);
          return Promise.resolve(args.data);
        }),
      },
    };

    prisma = {
      $transaction: jest.fn((fn: any) => fn(tx)),
      tx,
      insumo: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
        fields: { stockMinimo: Symbol('stockMinimo') },
      },
      proveedor: { findUnique: jest.fn() },
      productoReceta: { count: jest.fn() },
      stockMovimiento: {
        create: jest.fn((args: any) => {
          movimientos.push(args.data);
          return Promise.resolve(args.data);
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    adminInsumos = { reporteConsumo: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InsumosService,
        { provide: PrismaService, useValue: prisma },
        { provide: AdminInsumosService, useValue: adminInsumos },
      ],
    }).compile();

    service = module.get(InsumosService);
  });

  const DTO_ALTA = {
    nombre: '  Muzzarella  ',
    unidadMedida: 'kg',
    stockActual: 12,
    stockMinimo: 8,
  };

  describe('contarBajoMinimo', () => {
    it('compara stockActual contra el stockMinimo DEL INSUMO, en Postgres', async () => {
      prisma.insumo.count.mockResolvedValue(4);

      const total = await service.contarBajoMinimo();

      expect(total).toBe(4);
      // Es el aviso de la esquina del Home. Siempre fue contra la columna del
      // insumo, nunca contra el umbral global que se elimino: sacar el global
      // no puede cambiarle el numero.
      expect(prisma.insumo.count).toHaveBeenCalledWith({
        where: {
          activo: true,
          stockActual: { lt: prisma.insumo.fields.stockMinimo },
        },
      });
    });
  });

  describe('crear', () => {
    it('normaliza el nombre y guarda el minimo que vino en el DTO', async () => {
      await service.crear(DTO_ALTA as any);

      expect(prisma.tx.insumo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            nombre: 'Muzzarella',
            stockMinimo: 8,
            stockActual: 12,
            activo: true,
            proveedorId: null,
          }),
        }),
      );
    });

    it('le abre el ledger al insumo que nace con stock', async () => {
      await service.crear(DTO_ALTA as any);

      // Sin esto, el historial de un insumo cargado con 12 kg arrancaba en
      // blanco y el primer descuento aparecia saliendo de la nada.
      expect(movimientos).toEqual([
        expect.objectContaining({
          insumoId: 'i1',
          tipo: 'AJUSTE_MANUAL',
          cantidad: 12,
          stockAntes: 0,
          stockDespues: 12,
        }),
      ]);
    });

    it('no escribe nada en el ledger si nace en cero', async () => {
      await service.crear({ ...DTO_ALTA, stockActual: 0 } as any);

      expect(movimientos).toEqual([]);
    });

    it('acepta el alias stockInicial del form viejo', async () => {
      await service.crear({
        nombre: 'Muzzarella',
        unidadMedida: 'kg',
        stockInicial: 30,
        stockMinimo: 8,
      } as any);

      expect(prisma.tx.insumo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ stockActual: 30 }),
        }),
      );
    });

    it('rechaza un proveedor inexistente con 400 y no con un 500 de la FK', async () => {
      prisma.proveedor.findUnique.mockResolvedValue(null);

      await expect(
        service.crear({
          ...DTO_ALTA,
          proveedorId: '00000000-0000-4000-8000-000000000000',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.tx.insumo.create).not.toHaveBeenCalled();
    });
  });

  describe('actualizar', () => {
    beforeEach(() => {
      prisma.insumo.findUnique.mockResolvedValue({ id: 'i1', stockActual: 12 });
    });

    it('404 si el insumo no existe', async () => {
      prisma.insumo.findUnique.mockResolvedValue(null);

      await expect(service.actualizar('fantasma', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('deja rastro en el ledger cuando el PATCH corrige el stock', async () => {
      await service.actualizar('i1', { stockActual: 3 }, 'u1');

      // Antes el stock saltaba de 12 a 3 sin una linea que lo explicara, y el
      // modal de historial mostraba el hueco entre dos movimientos.
      expect(movimientos).toEqual([
        expect.objectContaining({
          insumoId: 'i1',
          tipo: 'AJUSTE_MANUAL',
          cantidad: -9,
          stockAntes: 12,
          stockDespues: 3,
          userId: 'u1',
        }),
      ]);
    });

    it('no ensucia el historial si el form reenvia el mismo stock', async () => {
      await service.actualizar('i1', { stockActual: 12 });

      expect(movimientos).toEqual([]);
    });

    it('no toca el stock ni el ledger si el PATCH no lo menciona', async () => {
      await service.actualizar('i1', { stockMinimo: 20 });

      expect(movimientos).toEqual([]);
      expect(prisma.tx.insumo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stockMinimo: 20,
            stockActual: undefined,
          }),
        }),
      );
    });

    it('desasigna el proveedor cuando llega null', async () => {
      await service.actualizar('i1', { proveedorId: null });

      expect(prisma.tx.insumo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ proveedor: { disconnect: true } }),
        }),
      );
    });
  });

  describe('obtenerMovimientos', () => {
    it('clampea el limit: sin techo, un ?limit=999999 se traia la tabla', async () => {
      await service.obtenerMovimientos('i1', 999999);

      expect(prisma.stockMovimiento.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
    });

    it('cae al default si el limit no es usable', async () => {
      await service.obtenerMovimientos('i1', undefined);
      await service.obtenerMovimientos('i1', -5);

      for (const llamada of prisma.stockMovimiento.findMany.mock.calls) {
        expect(llamada[0].take).toBe(50);
      }
    });
  });

  describe('reporteConsumo (forma vieja)', () => {
    it('delega en el agregado de Postgres y devuelve la forma que espera el panel actual', async () => {
      adminInsumos.reporteConsumo.mockResolvedValue({
        items: [
          {
            insumoId: 'i1',
            nombre: 'Muzzarella',
            unidadMedida: 'kg',
            consumido: 30,
            movimientos: 12,
            pctDelTotal: 25,
            porDia: [],
          },
        ],
      });

      const res = await service.reporteConsumo('2026-08-01', '2026-08-10');

      // Las fechas viajan como texto: el service nuevo las parsea en hora del
      // negocio. La version vieja hacia `new Date('2026-08-01')`, que se
      // interpreta como UTC y en un server en UTC-3 arrancaba el rango el 31.
      expect(adminInsumos.reporteConsumo).toHaveBeenCalledWith({
        desde: '2026-08-01',
        hasta: '2026-08-10',
        limite: 100,
      });
      expect(res).toEqual([
        {
          insumoId: 'i1',
          nombre: 'Muzzarella',
          unidadMedida: 'kg',
          totalConsumido: 30,
          cantidadMovimientos: 12,
        },
      ]);
    });
  });

  describe('borrar', () => {
    it('no deja borrar un insumo que esta en recetas', async () => {
      prisma.insumo.findUnique.mockResolvedValue({ id: 'i1' });
      prisma.productoReceta.count.mockResolvedValue(3);

      await expect(service.borrar('i1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.insumo.delete).not.toHaveBeenCalled();
    });
  });
});
