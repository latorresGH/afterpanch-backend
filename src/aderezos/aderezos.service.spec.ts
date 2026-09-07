import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AderezosService, clampLimite } from './aderezos.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * El CRUD viejo de /aderezos. No se le cambio la FORMA (lo consumen la carta,
 * el POS y la seccion de Productos ya reworkeada), pero si lo que estaba mal
 * por dentro: el default de 999, el `limit` sin techo y el borrado sin guard.
 */
describe('AderezosService (CRUD /aderezos)', () => {
  let service: AderezosService;
  let prisma: any;

  const ADEREZO = {
    id: 'a1',
    nombre: 'Mayonesa',
    stockActual: 4,
    stockMinimo: 10,
    unidadMedida: 'kg',
    activo: true,
    esGlobal: false,
  };

  beforeEach(async () => {
    const tx = {
      aderezo: { delete: jest.fn().mockResolvedValue({}) },
      aderezoPrecio: { deleteMany: jest.fn() },
      aderezoConsumo: { deleteMany: jest.fn() },
      aderezoCategoria: { deleteMany: jest.fn() },
      stockMovimiento: { deleteMany: jest.fn() },
    };

    prisma = {
      __tx: tx,
      $transaction: jest.fn((fn: any) => fn(tx)),
      aderezo: {
        findUnique: jest.fn().mockResolvedValue({ ...ADEREZO }),
        create: jest.fn((a: any) =>
          Promise.resolve({ id: 'nuevo', ...a.data }),
        ),
        update: jest.fn().mockResolvedValue({ ...ADEREZO }),
      },
      aderezoCategoria: { createMany: jest.fn(), deleteMany: jest.fn() },
      pedidoDetalle: { count: jest.fn().mockResolvedValue(0) },
      stockMovimiento: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AderezosService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AderezosService>(AderezosService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create — el bug del 999', () => {
    it('una salsa nueva arranca en 0, NO en 999', async () => {
      // El 999 era un default hardcodeado que nadie decidio: hacia que toda
      // salsa naciera "con stock de sobra" sin haberse contado, y por eso el
      // panel nunca podia avisar que faltaba.
      prisma.aderezo.findUnique.mockResolvedValueOnce(null);

      await service.create({ nombre: 'Alioli' } as any);

      expect(prisma.aderezo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ stockActual: 0 }),
        }),
      );
    });

    it('respeta el stock inicial cuando viene', async () => {
      prisma.aderezo.findUnique.mockResolvedValueOnce(null);
      await service.create({ nombre: 'Alioli', stockActual: 3 } as any);

      expect(prisma.aderezo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ stockActual: 3 }),
        }),
      );
    });

    it('sin unidad escribe "u" y ya no null', async () => {
      // Escribir null era la via por la que se colaban las filas sin unidad
      // que el backfill de 20260831000000 tuvo que arreglar.
      prisma.aderezo.findUnique.mockResolvedValueOnce(null);
      await service.create({ nombre: 'Alioli' } as any);

      expect(prisma.aderezo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ unidadMedida: 'u' }),
        }),
      );
    });

    it('rechaza un nombre repetido con un mensaje util', async () => {
      await expect(
        service.create({ nombre: 'Mayonesa' } as any),
      ).rejects.toThrow(/Ya existe un aderezo/i);
    });
  });

  describe('update', () => {
    it('un unidadMedida vacio ya no vuelve la unidad a null', async () => {
      await service.update('a1', { unidadMedida: '' } as any);

      const data = prisma.aderezo.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('unidadMedida');
    });

    it('una unidad valida se guarda', async () => {
      await service.update('a1', { unidadMedida: 'g' } as any);
      expect(prisma.aderezo.update.mock.calls[0][0].data.unidadMedida).toBe(
        'g',
      );
    });
  });

  describe('remove — guard de uso en pedidos', () => {
    it('400 si la salsa ya se uso en un pedido', async () => {
      // ⚠️ Sin este guard el DELETE NO falla: la relacion con PedidoDetalle es
      // many-to-many (`_AderezoToPedidoDetalle`) con ON DELETE CASCADE en las
      // dos foreign keys, asi que Postgres se lleva puestas las filas del join
      // en silencio y los pedidos historicos pierden que llevaban esta salsa.
      prisma.pedidoDetalle.count.mockResolvedValue(1);

      await expect(service.remove('a1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.remove('a1')).rejects.toThrow(/Pausala/i);
      expect(prisma.__tx.aderezo.delete).not.toHaveBeenCalled();
    });

    it('si nunca se uso, borra la salsa y todo lo que le cuelga', async () => {
      const res = await service.remove('a1');

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
  });

  describe('ajuste de stock atomico', () => {
    it('sumar usa increment y no un valor absoluto', async () => {
      // Es la diferencia con el PATCH de `stockActual`: increment lo resuelve
      // la base, asi que dos ajustes simultaneos no se pisan.
      await service.sumarStock('a1', 5);

      expect(prisma.aderezo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { stockActual: { increment: 5 } },
        }),
      );
      expect(prisma.stockMovimiento.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            aderezoId: 'a1',
            stockAntes: 4,
            stockDespues: 9,
          }),
        }),
      );
    });

    it('descontar usa decrement y frena si no alcanza el stock', async () => {
      await service.descontarStock('a1', 3);
      expect(prisma.aderezo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { stockActual: { decrement: 3 } },
        }),
      );

      await expect(service.descontarStock('a1', 999)).rejects.toThrow(
        /insuficiente/i,
      );
    });

    it('el motivo del body queda escrito en el movimiento', async () => {
      await service.sumarStock('a1', 2, 'Compra semanal');
      expect(prisma.stockMovimiento.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ motivo: 'Compra semanal' }),
        }),
      );
    });

    it('sin motivo arma uno con el signo y la cantidad', async () => {
      await service.sumarStock('a1', 2);
      expect(prisma.stockMovimiento.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ motivo: 'Stock manual +2' }),
        }),
      );
    });
  });

  describe('clampLimite — el historial ya no se trae la tabla entera', () => {
    it('techo en 200', () => {
      expect(clampLimite(999999)).toBe(200);
    });

    it('piso en 1', () => {
      expect(clampLimite(0)).toBe(1);
      expect(clampLimite(-5)).toBe(1);
    });

    it('sin limit cae al default', () => {
      expect(clampLimite(undefined)).toBe(50);
      expect(clampLimite(undefined, 20)).toBe(20);
    });

    it('NaN cae al default en vez de llegar a Prisma', () => {
      // `parseInt('abc')` daba NaN y Prisma lo rechaza con un 500.
      expect(clampLimite(NaN)).toBe(50);
    });

    it('obtenerMovimientos lo aplica', async () => {
      await service.obtenerMovimientos('a1', 999999);
      expect(prisma.stockMovimiento.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
    });

    it('obtenerMovimientosRecientes lo aplica con su propio default', async () => {
      await service.obtenerMovimientosRecientes();
      expect(prisma.stockMovimiento.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20 }),
      );
    });
  });
});
