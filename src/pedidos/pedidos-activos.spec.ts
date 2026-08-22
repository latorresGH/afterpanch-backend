import { Test, TestingModule } from '@nestjs/testing';
import { EstadoPedido } from '@prisma/client';
import {
  PedidosService,
  ESTADOS_MONITOR,
  MINUTOS_PEDIDO_DEMORADO,
} from './pedidos.service';
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

    it('NO cambia la forma de lo que ya leía /pos/monitor', async () => {
      // Los campos derivados se AGREGAN: todo lo que el monitor ya usaba tiene
      // que seguir llegando igual.
      const original = {
        id: 'p-1',
        tipo: 'DELIVERY',
        estado: 'EN_PREPARACION',
        total: 34200,
        costoEnvio: 3000,
        createdAt: new Date(),
        nombreCliente: 'Martina',
        detalles: [{ id: 'd-1', cantidad: 2 }],
      };
      prisma.pedido.findMany.mockResolvedValue([original]);

      const [pedido] = await service.listarActivos();

      expect(pedido).toMatchObject(original);
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

  describe('campos derivados (minutosTranscurridos / demorado)', () => {
    const haceMinutos = (n: number) => new Date(Date.now() - n * 60_000);

    it.each([
      [0, false],
      [1, false],
      [29, false],
      [30, true], // el umbral es inclusivo
      [31, true],
      [120, true],
    ])(
      'un pedido de hace %i min => demorado: %s',
      async (minutos, esperado) => {
        prisma.pedido.findMany.mockResolvedValue([
          { id: 'p-1', createdAt: haceMinutos(minutos) },
        ]);

        const [pedido] = await service.listarActivos();

        expect(pedido.minutosTranscurridos).toBe(minutos);
        expect(pedido.demorado).toBe(esperado);
      },
    );

    it('usa el umbral exportado, no un 30 suelto', () => {
      expect(MINUTOS_PEDIDO_DEMORADO).toBe(30);
    });

    it('nunca devuelve minutos negativos', async () => {
      // Reloj del cliente adelantado o createdAt en el futuro por skew.
      prisma.pedido.findMany.mockResolvedValue([
        { id: 'p-1', createdAt: new Date(Date.now() + 60_000) },
      ]);

      const [pedido] = await service.listarActivos();

      expect(pedido.minutosTranscurridos).toBe(0);
      expect(pedido.demorado).toBe(false);
    });

    it('no agrega ninguna query extra', async () => {
      prisma.pedido.findMany.mockResolvedValue([
        { id: 'p-1', createdAt: haceMinutos(10) },
        { id: 'p-2', createdAt: haceMinutos(40) },
      ]);

      await service.listarActivos();

      expect(prisma.pedido.findMany).toHaveBeenCalledTimes(1);
    });

    it('usa el mismo instante para todo el lote', async () => {
      // Dos pedidos creados a la vez tienen que dar el mismo número, sin que
      // los milisegundos del recorrido los separen.
      const mismoInstante = haceMinutos(29.999);
      prisma.pedido.findMany.mockResolvedValue([
        { id: 'p-1', createdAt: mismoInstante },
        { id: 'p-2', createdAt: mismoInstante },
      ]);

      const [a, b] = await service.listarActivos();

      expect(a.minutosTranscurridos).toBe(b.minutosTranscurridos);
      expect(a.demorado).toBe(b.demorado);
    });
  });
});
