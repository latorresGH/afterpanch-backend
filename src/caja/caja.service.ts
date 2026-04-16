import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TipoMovimientoCaja, EstadoPedido } from '@prisma/client';

@Injectable()
export class CajaService {
  constructor(private prisma: PrismaService) {}

  async registrarPagoPedido(
    pedidoId: string,
    confirmadoPor: string,
    gananciaRepartidor?: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const pedido = await tx.pedido.findUnique({
        where: { id: pedidoId },
        select: {
          id: true,
          estado: true,
          total: true,
          costoEnvio: true,
          tipo: true,
        },
      });

      if (!pedido) throw new NotFoundException('Pedido no encontrado');

      if (pedido.estado === EstadoPedido.CANCELADO) {
        throw new BadRequestException(
          'No se puede registrar pago de un pedido cancelado',
        );
      }

      const movimientoExistente = await tx.cajaMovimiento.findFirst({
        where: { pedidoId },
      });

      if (movimientoExistente) {
        throw new BadRequestException(
          'Este pedido ya tiene un movimiento de caja registrado',
        );
      }

      const montoTotal = Number(pedido.total);
      const costoEnvio = Number(pedido.costoEnvio) || 0;
      const gananciaRepart = gananciaRepartidor ?? costoEnvio;
      const gananciaNegocio = montoTotal - gananciaRepart;

      const movimiento = await tx.cajaMovimiento.create({
        data: {
          pedidoId,
          tipo: TipoMovimientoCaja.ENTRADA,
          montoTotal,
          gananciaNegocio,
          gananciaRepartidor: gananciaRepart,
          descripcion: `Pago registrado para pedido ${pedidoId}`,
          confirmadoPor,
          fechaConfirmacion: new Date(),
        },
      });

      return movimiento;
    });
  }

  async registrarMovimientoManual(data: {
    tipo: TipoMovimientoCaja;
    monto: number;
    descripcion?: string;
    confirmadoPor: string;
  }) {
    const { tipo, monto, descripcion, confirmadoPor } = data;

    return this.prisma.cajaMovimiento.create({
      data: {
        tipo,
        montoTotal: monto,
        gananciaNegocio: tipo === TipoMovimientoCaja.SALIDA ? -monto : monto,
        gananciaRepartidor: 0,
        descripcion: descripcion || `Movimiento manual de ${tipo}`,
        confirmadoPor,
        fechaConfirmacion: new Date(),
      },
    });
  }

  async obtenerResumenCaja(fechaInicio?: Date, fechaFin?: Date) {
    const where: any = {};

    if (fechaInicio || fechaFin) {
      where.fechaConfirmacion = {};
      if (fechaInicio) {
        const inicio = new Date(fechaInicio);
        inicio.setHours(0, 0, 0, 0);
        where.fechaConfirmacion.gte = inicio;
      }
      if (fechaFin) {
        const fin = new Date(fechaFin);
        fin.setHours(23, 59, 59, 999);
        where.fechaConfirmacion.lte = fin;
      }
    }

    const movimientos = await this.prisma.cajaMovimiento.findMany({
      where,
      include: {
        pedido: {
          select: {
            id: true,
            nombreCliente: true,
            apellidoCliente: true,
            total: true,
            estado: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const resumen = movimientos.reduce(
      (acc, mov) => {
        acc.totalEntradas += mov.tipo === 'ENTRADA' ? mov.montoTotal : 0;
        acc.totalSalidas += mov.tipo === 'SALIDA' ? mov.montoTotal : 0;
        acc.gananciaNegocioTotal += mov.gananciaNegocio;
        acc.gananciaRepartidorTotal += mov.gananciaRepartidor;
        return acc;
      },
      {
        totalEntradas: 0,
        totalSalidas: 0,
        gananciaNegocioTotal: 0,
        gananciaRepartidorTotal: 0,
        balance: 0,
      },
    );

    resumen.balance = resumen.totalEntradas - resumen.totalSalidas;

    return {
      resumen,
      movimientos,
    };
  }

  async obtenerMovimientosPorPedido(pedidoId: string) {
    return this.prisma.cajaMovimiento.findMany({
      where: { pedidoId },
      include: {
        pedido: {
          select: {
            id: true,
            nombreCliente: true,
            apellidoCliente: true,
            total: true,
          },
        },
      },
    });
  }

  async eliminarMovimiento(id: string, motivo: string) {
    const movimiento = await this.prisma.cajaMovimiento.findUnique({
      where: { id },
    });

    if (!movimiento) {
      throw new NotFoundException('Movimiento no encontrado');
    }

    return this.prisma.cajaMovimiento.update({
      where: { id },
      data: {
        descripcion: `${movimiento.descripcion} [ANULADO: ${motivo}]`,
      },
    });
  }
}
