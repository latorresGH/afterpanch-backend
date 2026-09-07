import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, TipoMovimientoCaja } from '@prisma/client';
import { ActorCaja, CajaService } from './caja.service';
import { PrismaService } from '../prisma/prisma.service';

const SOL: ActorCaja = { id: 'u-sol', nombre: 'Sol Medina' };

/** El P2002 real que tira Prisma cuando choca contra la UNIQUE. */
const conflictoUnicidad = () =>
  new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`pedidoId`,`tipo`)',
    {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['pedidoId', 'tipo'] },
    },
  );

describe('CajaService', () => {
  let service: CajaService;
  let prisma: {
    pedido: { findUnique: jest.Mock };
    cajaMovimiento: { findFirst: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };

  const PEDIDO_OK = {
    id: 'p-1',
    estado: 'ENTREGADO',
    total: 22000,
    costoEnvio: 2800,
    tipo: 'DELIVERY',
  };

  beforeEach(async () => {
    prisma = {
      pedido: { findUnique: jest.fn().mockResolvedValue(PEDIDO_OK) },
      cajaMovimiento: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: any) => ({ id: 'mov-nuevo', ...data })),
      },
      // La transacción corre el callback con el mismo mock: alcanza para ver
      // qué se le pide a la base y con qué datos.
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CajaService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CajaService);
  });

  describe('registrarPagoPedido — doble cobro', () => {
    it('confirma un pedido sin cobrar y marca yaExistia en false', async () => {
      const res = await service.registrarPagoPedido('p-1', SOL);

      expect(res.yaExistia).toBe(false);
      expect(res.movimiento.montoTotal).toBe(24800);
      expect(prisma.cajaMovimiento.create).toHaveBeenCalledTimes(1);
    });

    it('busca el movimiento previo acotado a ENTRADA (igual que la UNIQUE)', async () => {
      await service.registrarPagoPedido('p-1', SOL);

      expect(prisma.cajaMovimiento.findFirst).toHaveBeenCalledWith({
        where: { pedidoId: 'p-1', tipo: TipoMovimientoCaja.ENTRADA },
      });
    });

    it('si ya estaba cobrado NO inserta de nuevo y devuelve el que había', async () => {
      prisma.cajaMovimiento.findFirst.mockResolvedValue({
        id: 'mov-viejo',
        montoTotal: 24800,
      });

      const res = await service.registrarPagoPedido('p-1', SOL);

      expect(res.yaExistia).toBe(true);
      expect(res.movimiento.id).toBe('mov-viejo');
      expect(prisma.cajaMovimiento.create).not.toHaveBeenCalled();
    });

    it('la carrera perdida contra la UNIQUE es idempotente, no un error', async () => {
      // El findFirst de adentro de la transacción no vio nada (la otra request
      // todavía no había commiteado), así que se intenta el INSERT y explota.
      prisma.cajaMovimiento.create.mockRejectedValueOnce(conflictoUnicidad());
      prisma.cajaMovimiento.findFirst
        .mockResolvedValueOnce(null) // dentro de la transacción
        .mockResolvedValueOnce({ id: 'mov-ganador', montoTotal: 24800 }); // relectura

      const res = await service.registrarPagoPedido('p-1', SOL);

      expect(res.yaExistia).toBe(true);
      expect(res.movimiento.id).toBe('mov-ganador');
    });

    it('un P2002 sin movimiento detrás sí se propaga: no se tapa nada', async () => {
      prisma.cajaMovimiento.create.mockRejectedValueOnce(conflictoUnicidad());
      prisma.cajaMovimiento.findFirst.mockResolvedValue(null);

      await expect(service.registrarPagoPedido('p-1', SOL)).rejects.toThrow(
        Prisma.PrismaClientKnownRequestError,
      );
    });

    it('un error que NO es de unicidad se propaga tal cual', async () => {
      prisma.cajaMovimiento.create.mockRejectedValueOnce(new Error('boom'));

      await expect(service.registrarPagoPedido('p-1', SOL)).rejects.toThrow('boom');
    });

    it('un pedido inexistente sigue siendo 404', async () => {
      prisma.pedido.findUnique.mockResolvedValue(null);

      await expect(service.registrarPagoPedido('p-x', SOL)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('un pedido cancelado sigue siendo 400', async () => {
      prisma.pedido.findUnique.mockResolvedValue({
        ...PEDIDO_OK,
        estado: 'CANCELADO',
      });

      await expect(service.registrarPagoPedido('p-1', SOL)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('autoría: siempre del JWT, nunca del body', () => {
    it('el cobro guarda registradoPorId con el id del actor', async () => {
      await service.registrarPagoPedido('p-1', SOL);

      expect(prisma.cajaMovimiento.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          registradoPorId: 'u-sol',
          confirmadoPor: 'Sol Medina',
        }),
      });
    });

    it('el movimiento manual también guarda al actor', async () => {
      await service.registrarMovimientoManual({
        tipo: TipoMovimientoCaja.SALIDA,
        monto: 42600,
        descripcion: 'Muzzarella 5 kg',
        actor: SOL,
      });

      expect(prisma.cajaMovimiento.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          registradoPorId: 'u-sol',
          confirmadoPor: 'Sol Medina',
        }),
      });
    });

    it('dos actores distintos quedan atribuidos distinto', async () => {
      await service.registrarPagoPedido('p-1', SOL);
      await service.registrarPagoPedido('p-1', { id: 'u-beto', nombre: 'Beto' });

      const [primera, segunda] = prisma.cajaMovimiento.create.mock.calls;
      expect(primera[0].data.registradoPorId).toBe('u-sol');
      expect(segunda[0].data.registradoPorId).toBe('u-beto');
    });
  });

  describe('registrarMovimientoManual — el gasto que se restaba dos veces', () => {
    const manual = (tipo: TipoMovimientoCaja, monto: number) =>
      service.registrarMovimientoManual({ tipo, monto, actor: SOL });

    it('una SALIDA ya NO escribe gananciaNegocio en negativo', async () => {
      await manual(TipoMovimientoCaja.SALIDA, 5000);

      expect(prisma.cajaMovimiento.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          montoTotal: 5000,
          gananciaNegocio: 0,
          gananciaRepartidor: 0,
        }),
      });
    });

    it('una ENTRADA manual tampoco inventa ganancia de negocio', async () => {
      await manual(TipoMovimientoCaja.ENTRADA, 40000);

      expect(prisma.cajaMovimiento.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ gananciaNegocio: 0 }),
      });
    });

    it('ENTRADA y SALIDA se guardan con monto positivo: el signo lo da el tipo', async () => {
      await expect(manual(TipoMovimientoCaja.SALIDA, -5000)).rejects.toThrow(
        BadRequestException,
      );
      await expect(manual(TipoMovimientoCaja.ENTRADA, -5000)).rejects.toThrow(
        BadRequestException,
      );
      await expect(manual(TipoMovimientoCaja.SALIDA, 0)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('un AJUSTE sí puede ser negativo: es una corrección', async () => {
      await manual(TipoMovimientoCaja.AJUSTE, -3000);

      expect(prisma.cajaMovimiento.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ montoTotal: -3000 }),
      });
    });

    it('un AJUSTE de 0 no corrige nada y se rechaza', async () => {
      await expect(manual(TipoMovimientoCaja.AJUSTE, 0)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('un monto que no es número se rechaza antes de tocar la base', async () => {
      await expect(manual(TipoMovimientoCaja.SALIDA, NaN)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.cajaMovimiento.create).not.toHaveBeenCalled();
    });
  });
});
