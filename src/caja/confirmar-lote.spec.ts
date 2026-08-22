import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CajaService } from './caja.service';
import { PrismaService } from '../prisma/prisma.service';

describe('POST /caja/confirmar-lote — confirmarLote', () => {
  let service: CajaService;
  let registrarPago: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CajaService, { provide: PrismaService, useValue: {} }],
    }).compile();

    service = module.get(CajaService);
    registrarPago = jest.spyOn(service, 'registrarPagoPedido');
  });

  const movimiento = (id: string, monto: number) =>
    ({ id: `mov-${id}`, montoTotal: monto }) as any;

  it('confirma todos los pedidos del lote', async () => {
    registrarPago
      .mockResolvedValueOnce(movimiento('a', 19850))
      .mockResolvedValueOnce(movimiento('b', 12000));

    const res = await service.confirmarLote(['p-a', 'p-b'], 'Maxi');

    expect(res.confirmados).toHaveLength(2);
    expect(res.fallidos).toHaveLength(0);
    expect(res.totalConfirmado).toBe(31850);
  });

  it('un pedido inválido NO tumba a los demás (éxito parcial)', async () => {
    registrarPago
      .mockResolvedValueOnce(movimiento('a', 19850))
      .mockRejectedValueOnce(
        new BadRequestException('Este pedido ya tiene un movimiento de caja registrado'),
      )
      .mockResolvedValueOnce(movimiento('c', 5000));

    const res = await service.confirmarLote(['p-a', 'p-b', 'p-c'], 'Maxi');

    expect(res.confirmados.map((c) => c.pedidoId)).toEqual(['p-a', 'p-c']);
    expect(res.fallidos).toEqual([
      { pedidoId: 'p-b', motivo: 'Este pedido ya tiene un movimiento de caja registrado' },
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

    const res = await service.confirmarLote(['p-a', 'p-b'], 'Maxi');

    expect(res.confirmados).toHaveLength(0);
    expect(res.fallidos.map((f) => f.motivo)).toEqual([
      'Pedido no encontrado',
      'No se puede registrar pago de un pedido cancelado',
    ]);
    expect(res.totalConfirmado).toBe(0);
  });

  it('nunca tira: un lote entero fallido devuelve resultado igual', async () => {
    registrarPago.mockRejectedValue(new Error('boom'));

    await expect(service.confirmarLote(['p-a'], 'Maxi')).resolves.toBeDefined();
  });

  it('deduplica ids repetidos', async () => {
    registrarPago.mockResolvedValue(movimiento('a', 1000));

    const res = await service.confirmarLote(['p-a', 'p-a', 'p-a'], 'Maxi');

    expect(registrarPago).toHaveBeenCalledTimes(1);
    expect(res.confirmados).toHaveLength(1);
  });

  it('pasa el confirmadoPor recibido (que el controller saca del JWT)', async () => {
    registrarPago.mockResolvedValue(movimiento('a', 1000));

    await service.confirmarLote(['p-a'], 'Sol Medina');

    expect(registrarPago).toHaveBeenCalledWith('p-a', 'Sol Medina');
  });

  it('NO pasa gananciaRepartidor: cada pedido usa su propio costoEnvio', async () => {
    // Confirma todos sin distinción, incluso los que tienen costoEnvio 0.
    registrarPago.mockResolvedValue(movimiento('a', 1000));

    await service.confirmarLote(['p-a'], 'Maxi');

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
      return movimiento('x', 100);
    });

    await service.confirmarLote(['p-a', 'p-b', 'p-c'], 'Maxi');

    expect(maxSimultaneos).toBe(1);
  });
});
