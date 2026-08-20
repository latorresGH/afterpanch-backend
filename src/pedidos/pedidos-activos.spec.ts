import { Test, TestingModule } from '@nestjs/testing';
import { EstadoPedido } from '@prisma/client';
import { PedidosService, ESTADOS_MONITOR } from './pedidos.service';
import { PrismaService } from '../prisma/prisma.service';
import { OfertasCalculatorService } from '../ofertas/ofertas-calculator.service';
import { NegocioConfigService } from '../config/config.service';
import { PedidosGateway } from './pedidos.gateway';

describe('GET /pedidos/activos — listarActivos', () => {
  let service: PedidosService;
  let prisma: { pedido: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { pedido: { findMany: jest.fn().mockResolvedValue([]) } };

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

  describe('ESTADOS_MONITOR', () => {
    it('excluye los cerrados', () => {
      expect(ESTADOS_MONITOR).not.toContain(EstadoPedido.ENTREGADO);
      expect(ESTADOS_MONITOR).not.toContain(EstadoPedido.CANCELADO);
    });

    it('INCLUYE PROBLEMA_DIRECCION', () => {
      // El monitor filtra hoy en el cliente por `!== CANCELADO && !== ENTREGADO`,
      // así que estos pedidos SÍ se ven. La constante ESTADOS_ABIERTOS que ya
      // existía en el service no lo incluye: reusarla habría escondido estos
      // pedidos justo en la pantalla donde se resuelven.
      expect(ESTADOS_MONITOR).toContain(EstadoPedido.PROBLEMA_DIRECCION);
    });

    it('cubre exactamente todo el enum menos los dos cerrados', () => {
      const todos = Object.values(EstadoPedido);
      expect(ESTADOS_MONITOR.slice().sort()).toEqual(
        todos
          .filter(
            (e) =>
              e !== EstadoPedido.ENTREGADO && e !== EstadoPedido.CANCELADO,
          )
          .sort(),
      );
    });

    it('replica el filtro que hoy hace el cliente, estado por estado', () => {
      for (const estado of Object.values(EstadoPedido)) {
        const loMuestraElClienteHoy =
          estado !== EstadoPedido.CANCELADO && estado !== EstadoPedido.ENTREGADO;
        expect(ESTADOS_MONITOR.includes(estado)).toBe(loMuestraElClienteHoy);
      }
    });
  });

  describe('la query', () => {
    it('filtra por estado server-side', async () => {
      await service.listarActivos();

      const args = prisma.pedido.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ estado: { in: ESTADOS_MONITOR } });
    });

    it('ordena por fecha ascendente (lo más viejo primero)', async () => {
      await service.listarActivos();

      const args = prisma.pedido.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual({ createdAt: 'asc' });
    });

    it('usa select acotado, no include del árbol completo', async () => {
      await service.listarActivos();

      const args = prisma.pedido.findMany.mock.calls[0][0];
      expect(args.select).toBeDefined();
      expect(args.include).toBeUndefined();
    });

    it('trae todos los campos que renderiza el monitor', async () => {
      await service.listarActivos();

      const { select } = prisma.pedido.findMany.mock.calls[0][0];
      for (const campo of [
        'id',
        'tipo',
        'estado',
        'total',
        'costoEnvio',
        'createdAt',
        'nombreCliente',
        'apellidoCliente',
        'numeroCliente',
        'metodoPago',
        'direccion',
        'repartidorId',
        'repartidor',
        'detalles',
      ]) {
        expect(select[campo]).toBeTruthy();
      }
    });

    it('trae los campos de detalle que necesitan la tarjeta y el ticket', async () => {
      await service.listarActivos();

      const { select } = prisma.pedido.findMany.mock.calls[0][0];
      const detalle = select.detalles.select;
      for (const campo of [
        'cantidad',
        'subtotal',
        'precioUnitario',
        'notas',
        'sinExtras',
        'extras',
        'comboId',
        'comboInstanciaId',
        'comboNombre',
        'producto',
        'aderezos',
      ]) {
        expect(detalle[campo]).toBeTruthy();
      }
    });

    it('NO trae movimientosCaja (el monitor no los muestra)', async () => {
      await service.listarActivos();

      const { select } = prisma.pedido.findMany.mock.calls[0][0];
      expect(select.movimientosCaja).toBeUndefined();
    });

    it('de producto y aderezos trae solo lo mínimo, no la fila entera', async () => {
      await service.listarActivos();

      const { select } = prisma.pedido.findMany.mock.calls[0][0];
      const detalle = select.detalles.select;

      // `producto: true` traería precio, descripcion, imagenUrl, etc. por cada
      // línea de cada pedido — que es lo que hace GET /pedidos hoy.
      expect(detalle.producto).toEqual({
        select: { id: true, nombre: true },
      });
      expect(detalle.aderezos).toEqual({
        select: { id: true, nombre: true },
      });
    });
  });
});
