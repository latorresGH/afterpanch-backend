import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PedidosService } from './pedidos.service';
import { PrismaService } from '../prisma/prisma.service';
import { OfertasCalculatorService } from '../ofertas/ofertas-calculator.service';
import { NegocioConfigService } from '../config/config.service';
import { PedidosGateway } from './pedidos.gateway';

describe('PedidosService', () => {
  let service: PedidosService;
  let prisma: { pedido: { findUnique: jest.Mock } };

  beforeEach(async () => {
    prisma = { pedido: { findUnique: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PedidosService,
        { provide: PrismaService, useValue: prisma },
        { provide: OfertasCalculatorService, useValue: {} },
        { provide: NegocioConfigService, useValue: {} },
        { provide: PedidosGateway, useValue: {} },
      ],
    }).compile();

    service = module.get<PedidosService>(PedidosService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findOne (trackingCode)', () => {
    const pedidoBase = { id: 'p1', trackingCode: 'abc123' };

    it('lanza NotFoundException si el pedido no existe', async () => {
      prisma.pedido.findUnique.mockResolvedValue(null);
      await expect(service.findOne('p1')).rejects.toThrow(NotFoundException);
    });

    it('lanza NotFoundException si el trackingCode no coincide', async () => {
      prisma.pedido.findUnique.mockResolvedValue(pedidoBase);
      await expect(service.findOne('p1', 'wrong')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza NotFoundException si no se manda code y el pedido tiene trackingCode', async () => {
      prisma.pedido.findUnique.mockResolvedValue(pedidoBase);
      await expect(service.findOne('p1')).rejects.toThrow(NotFoundException);
    });

    it('devuelve el pedido si el code coincide', async () => {
      prisma.pedido.findUnique.mockResolvedValue(pedidoBase);
      await expect(service.findOne('p1', 'abc123')).resolves.toBe(
        pedidoBase,
      );
    });

    it('devuelve el pedido sin code si es un pedido legacy (trackingCode null)', async () => {
      prisma.pedido.findUnique.mockResolvedValue({
        id: 'p1',
        trackingCode: null,
      });
      await expect(service.findOne('p1')).resolves.toBeDefined();
    });

    it('devuelve el pedido sin code si quien llama es empleado', async () => {
      prisma.pedido.findUnique.mockResolvedValue(pedidoBase);
      await expect(
        service.findOne('p1', undefined, true),
      ).resolves.toBe(pedidoBase);
    });
  });
});
