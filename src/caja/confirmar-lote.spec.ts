import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ActorCaja, CajaService } from './caja.service';
import { PrismaService } from '../prisma/prisma.service';

describe('POST /caja/confirmar-lote — confirmarLote', () => {
  let service: CajaService;
  let registrarPago: jest.SpyInstance;

  const MAXI: ActorCaja = { id: 'u-maxi', nombre: 'Maxi' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CajaService, { provide: PrismaService, useValue: {} }],
    }).compile();

    service = module.get(CajaService);
    registrarPago = jest.spyOn(service, 'registrarPagoPedido');
  });

  const nuevo = (id: string, monto: number) =>
    ({ movimiento: { id: `mov-${id}`, montoTotal: monto }, yaExistia: false }) as any;

  const yaEstaba = (id: string, monto: number) =>
    ({ movimiento: { id: `mov-${id}`, montoTotal: monto }, yaExistia: true }) as any;

  it('confirma todos los pedidos del lote', async () => {
    registrarPago
      .mockResolvedValueOnce(nuevo('a', 19850))
      .mockResolvedValueOnce(nuevo('b', 12000));

    const res = await service.confirmarLote(['p-a', 'p-b'], MAXI);

    expect(res.confirmados).toHaveLength(2);
    expect(res.yaConfirmados).toHaveLength(0);
    expect(res.fallidos).toHaveLength(0);
    expect(res.totalConfirmado).toBe(31850);
  });

  it('un pedido inválido NO tumba a los demás (éxito parcial)', async () => {
    registrarPago
      .mockResolvedValueOnce(nuevo('a', 19850))
      .mockRejectedValueOnce(
        new BadRequestException('No se puede registrar pago de un pedido cancelado'),
      )
      .mockResolvedValueOnce(nuevo('c', 5000));

    const res = await service.confirmarLote(['p-a', 'p-b', 'p-c'], MAXI);

    expect(res.confirmados.map((c) => c.pedidoId)).toEqual(['p-a', 'p-c']);
    expect(res.fallidos).toEqual([
      { pedidoId: 'p-b', motivo: 'No se puede registrar pago de un pedido cancelado' },
    ]);
    // El total suma SOLO lo que entró de verdad.
    expect(res.totalConfirmado).toBe(24850);
  });

  it('reporta el motivo de cada fallo', async () => {
    registrarPago
      .mockRejectedValueOnce(new NotFoundException('Pedido no encontrado'))
      .mockRejectedValueOnce(
        new BadRequestException('No se puede registrar pago de un pedido cancelado'),
      );

    const res = await service.confirmarLote(['p-a', 'p-b'], MAXI);

    expect(res.confirmados).toHaveLength(0);
    expect(res.fallidos.map((f) => f.motivo)).toEqual([
      'Pedido no encontrado',
      'No se puede registrar pago de un pedido cancelado',
    ]);
    expect(res.totalConfirmado).toBe(0);
  });

  it('nunca tira: un lote entero fallido devuelve resultado igual', async () => {
    registrarPago.mockRejectedValue(new Error('boom'));

    await expect(service.confirmarLote(['p-a'], MAXI)).resolves.toBeDefined();
  });

  it('deduplica ids repetidos', async () => {
    registrarPago.mockResolvedValue(nuevo('a', 1000));

    const res = await service.confirmarLote(['p-a', 'p-a', 'p-a'], MAXI);

    expect(registrarPago).toHaveBeenCalledTimes(1);
    expect(res.confirmados).toHaveLength(1);
  });

  it('pasa el actor recibido (que el controller saca del JWT)', async () => {
    registrarPago.mockResolvedValue(nuevo('a', 1000));

    await service.confirmarLote(['p-a'], { id: 'u-sol', nombre: 'Sol Medina' });

    expect(registrarPago).toHaveBeenCalledWith('p-a', {
      id: 'u-sol',
      nombre: 'Sol Medina',
    });
  });

  it('NO pasa gananciaRepartidor: cada pedido usa su propio costoEnvio', async () => {
    // Confirma todos sin distinción, incluso los que tienen costoEnvio 0.
    registrarPago.mockResolvedValue(nuevo('a', 1000));

    await service.confirmarLote(['p-a'], MAXI);

    expect(registrarPago.mock.calls[0]).toHaveLength(2);
    expect(registrarPago.mock.calls[0][2]).toBeUndefined();
  });

  it('procesa de a uno, no en paralelo', async () => {
    let enVuelo = 0;
    let maxSimultaneos = 0;
    registrarPago.mockImplementation(async () => {
      enVuelo++;
      maxSimultaneos = Math.max(maxSimultaneos, enVuelo);
      await new Promise((r) => setTimeout(r, 1));
      enVuelo--;
      return nuevo('x', 100);
    });

    await service.confirmarLote(['p-a', 'p-b', 'p-c'], MAXI);

    expect(maxSimultaneos).toBe(1);
  });

  describe('pedidos que YA estaban cobrados', () => {
    it('van a `yaConfirmados`, no a `fallidos`: no son un error', async () => {
      registrarPago.mockResolvedValueOnce(yaEstaba('a', 19850));

      const res = await service.confirmarLote(['p-a'], MAXI);

      expect(res.fallidos).toHaveLength(0);
      expect(res.confirmados).toHaveLength(0);
      expect(res.yaConfirmados).toEqual([
        { pedidoId: 'p-a', movimientoId: 'mov-a' },
      ]);
    });

    it('NO suman a totalConfirmado: esa plata ya estaba contada', async () => {
      registrarPago
        .mockResolvedValueOnce(nuevo('a', 10000))
        .mockResolvedValueOnce(yaEstaba('b', 99999))
        .mockResolvedValueOnce(nuevo('c', 5000));

      const res = await service.confirmarLote(['p-a', 'p-b', 'p-c'], MAXI);

      // 10000 + 5000, sin los 99999 que ya estaban en caja de antes.
      expect(res.totalConfirmado).toBe(15000);
      expect(res.confirmados).toHaveLength(2);
      expect(res.yaConfirmados).toHaveLength(1);
    });

    it('un lote entero ya cobrado no reporta ni un error', async () => {
      registrarPago.mockResolvedValue(yaEstaba('x', 5000));

      const res = await service.confirmarLote(['p-a', 'p-b'], MAXI);

      expect(res.fallidos).toHaveLength(0);
      expect(res.yaConfirmados).toHaveLength(2);
      expect(res.totalConfirmado).toBe(0);
    });
  });
});
