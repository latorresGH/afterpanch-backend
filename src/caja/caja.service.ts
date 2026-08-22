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

      const productosTotal = Number(pedido.total);
      const costoEnvio = Number(pedido.costoEnvio) || 0;
      const montoTotal = productosTotal + costoEnvio;
      const gananciaRepart = gananciaRepartidor ?? costoEnvio;

      if (gananciaRepart > montoTotal) {
        throw new BadRequestException(
          `La ganancia del repartidor (${gananciaRepart}) no puede ser mayor al total del pedido (${montoTotal})`,
        );
      }

      const gananciaNegocio = productosTotal;

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

  /**
   * Confirma el cobro de varios pedidos de una.
   *
   * Cada pedido va en SU PROPIA transacción (reusando `registrarPagoPedido`),
   * no en una sola global: si uno está cancelado o ya tenía movimiento, no
   * tiene por qué tumbar a los otros cuatro. Por eso reporta éxito parcial en
   * vez de tirar.
   *
   * Confirma todos sin distinción, con el `costoEnvio` que cada pedido tenga
   * en ese momento —incluso 0—, que es el valor que `registrarPagoPedido`
   * toma por defecto como ganancia del repartidor.
   *
   * Secuencial a propósito: en paralelo serían N transacciones simultáneas
   * compitiendo por el pool de conexiones, para un lote que como mucho tiene
   * unas pocas decenas de pedidos.
   */
  async confirmarLote(pedidoIds: string[], confirmadoPor: string) {
    const confirmados: Array<{
      pedidoId: string;
      movimientoId: string;
      monto: number;
    }> = [];
    const fallidos: Array<{ pedidoId: string; motivo: string }> = [];

    // Sin duplicados: si llega el mismo id dos veces, el segundo fallaría con
    // "ya tiene un movimiento" y ensuciaría el reporte.
    for (const pedidoId of [...new Set(pedidoIds)]) {
      try {
        const movimiento = await this.registrarPagoPedido(
          pedidoId,
          confirmadoPor,
        );
        confirmados.push({
          pedidoId,
          movimientoId: movimiento.id,
          monto: movimiento.montoTotal,
        });
      } catch (error: any) {
        fallidos.push({
          pedidoId,
          motivo: error?.message ?? 'Error desconocido',
        });
      }
    }

    return {
      confirmados,
      fallidos,
      totalConfirmado: confirmados.reduce((acc, c) => acc + c.monto, 0),
    };
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

  /**
   * Resumen de caja de un rango, resuelto con `aggregate` en Postgres.
   *
   * `obtenerResumenCaja` hace `findMany` + `reduce` en JS: se trae TODOS los
   * movimientos con el pedido joineado solo para sumar cuatro números. Acá no
   * viaja ninguna fila: la base devuelve los totales ya calculados.
   * (No se tocó el método viejo: lo usan la pantalla de caja y el hook actual.)
   */
  async getResumenAgregado(inicio: Date, fin: Date) {
    const rango = { fechaConfirmacion: { gte: inicio, lte: fin } };

    const [entradas, salidas] = await Promise.all([
      this.prisma.cajaMovimiento.aggregate({
        where: { ...rango, tipo: TipoMovimientoCaja.ENTRADA },
        _sum: { montoTotal: true },
        _count: { _all: true },
      }),
      this.prisma.cajaMovimiento.aggregate({
        where: { ...rango, tipo: TipoMovimientoCaja.SALIDA },
        _sum: { montoTotal: true },
      }),
    ]);

    const cobrado = entradas._sum.montoTotal ?? 0;
    const totalSalidas = salidas._sum.montoTotal ?? 0;
    const ticketsCerrados = entradas._count._all;

    return {
      cobrado,
      entradas: cobrado,
      salidas: totalSalidas,
      balance: cobrado - totalSalidas,
      ticketsCerrados,
      ticketPromedio: ticketsCerrados > 0 ? Math.round(cobrado / ticketsCerrados) : 0,
    };
  }

  /**
   * Movimientos de un rango, para la lista del Home. Acotado por fecha (un
   * día), así que no necesita paginar: no crece con el histórico.
   */
  async getMovimientosDelRango(inicio: Date, fin: Date) {
    return this.prisma.cajaMovimiento.findMany({
      where: { fechaConfirmacion: { gte: inicio, lte: fin } },
      select: {
        id: true,
        tipo: true,
        montoTotal: true,
        descripcion: true,
        confirmadoPor: true,
        fechaConfirmacion: true,
        pedido: {
          select: { id: true, nombreCliente: true, apellidoCliente: true },
        },
      },
      orderBy: { fechaConfirmacion: 'desc' },
    });
  }

  private buildFechaWhere(fechaInicio?: Date, fechaFin?: Date) {
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
    return where;
  }

  async obtenerResumenCaja(fechaInicio?: Date, fechaFin?: Date) {
    const where = this.buildFechaWhere(fechaInicio, fechaFin);
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

  async getHistorialPaginado(
    pagina: number,
    limit: number,
    fechaInicio?: Date,
    fechaFin?: Date,
  ) {
    const where = this.buildFechaWhere(fechaInicio, fechaFin);
    const skip = (pagina - 1) * limit;

    const [movimientos, total] = await Promise.all([
      this.prisma.cajaMovimiento.findMany({
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
        skip,
        take: limit,
      }),
      this.prisma.cajaMovimiento.count({ where }),
    ]);

    return {
      movimientos,
      total,
      pagina,
      totalPaginas: Math.ceil(total / limit),
      limit,
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
