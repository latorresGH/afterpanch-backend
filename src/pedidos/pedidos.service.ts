import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreatePedidoDto, TipoPedidoDto } from './dto/create-pedido.dto';
import { EstadoPedido, Prisma, Role, MetodoPago } from '@prisma/client';
import { OfertasCalculatorService } from '../ofertas/ofertas-calculator.service';

const ESTADOS_ABIERTOS: EstadoPedido[] = [
  EstadoPedido.PENDIENTE,
  EstadoPedido.EN_CAMINO,
];

const LIMITE_EXTRAS_GRATIS = 3;

@Injectable()
export class PedidosService {
  constructor(
    private prisma: PrismaService,
    private ofertasCalculator: OfertasCalculatorService,
  ) {}

  async crearPedido(dto: CreatePedidoDto) {
    const {
      tipo,
      direccion,
      detalles,
      pedidoId,
      nombreCliente,
      metodoPago,
      numeroCliente,
    } = dto;

    if (!detalles || detalles.length === 0) {
      throw new BadRequestException('El pedido no tiene productos');
    }

    if (tipo === TipoPedidoDto.DELIVERY && (!direccion || !direccion.trim())) {
      throw new BadRequestException(
        'La dirección es obligatoria para DELIVERY',
      );
    }

    const nombreClienteLimpio = nombreCliente?.trim() || null;
    const numeroClienteLimpio = numeroCliente?.trim() || null;

    if (
      !pedidoId &&
      (!nombreClienteLimpio || nombreClienteLimpio.length === 0)
    ) {
      throw new BadRequestException('nombreCliente es obligatorio');
    }

    return this.prisma.$transaction(async (tx) => {
      // -----------------------------
      // 1) Traer productos
      // -----------------------------
      const productoIds = detalles.map((d) => d.productoId);
      const productos = await tx.producto.findMany({
        where: { id: { in: productoIds } },
        select: { id: true, precio: true, activo: true, nombre: true },
      });

      const prodMap = new Map(
        productos.map((p) => [
          p.id,
          {
            precio: Number(p.precio),
            activo: Boolean(p.activo),
            nombre: p.nombre,
          },
        ]),
      );

      for (const pid of productoIds) {
        if (!prodMap.has(pid))
          throw new BadRequestException(`Producto no encontrado: ${pid}`);
        if (prodMap.get(pid)!.activo === false)
          throw new BadRequestException(`Producto inactivo: ${pid}`);
      }

      // -----------------------------
      // 2) Traer extras y Validar Aderezos
      // -----------------------------
      const extraIds = detalles
        .flatMap((d) => (d as any).extras ?? [])
        .map((e: any) => e.extraId);
      const extrasUnicos = Array.from(new Set(extraIds));

      const extrasDb = extrasUnicos.length
        ? await tx.extra.findMany({
            where: { id: { in: extrasUnicos } },
            select: {
              id: true,
              nombre: true,
              precio: true,
              stockActual: true,
              activo: true,
            },
          })
        : [];

      const extraMap = new Map(
        extrasDb.map((e) => [e.id, { ...e, precio: Number(e.precio) }]),
      );

      // Validar Aderezos (NUEVO)
      const todosLosAderezosIds = detalles
        .flatMap((d) => (d as any).aderezosIds ?? [])
        .map((id: any) => String(id));

      if (todosLosAderezosIds.length > 0) {
        const aderezosExistentes = await tx.aderezo.findMany({
          where: { id: { in: todosLosAderezosIds } },
          select: { id: true },
        });
        if (aderezosExistentes.length !== new Set(todosLosAderezosIds).size) {
          throw new BadRequestException('Uno o más aderezos no existen');
        }
      }

      // -----------------------------
      // 3) Armar detalles + calcular total
      // -----------------------------
      let totalNuevosItems = 0;
      const detallesCreate: Prisma.PedidoDetalleCreateWithoutPedidoInput[] = [];

      for (const d of detalles as any[]) {
        const base = prodMap.get(d.productoId)!;
        const cantidad = Number(d.cantidad);
        const precioUnitario = d.precioUnitario ?? base.precio;

        // Lógica de Extras (se mantiene igual)
        const extrasDto = Array.isArray(d.extras) ? d.extras : [];
        const extrasNorm = extrasDto.map((e) => ({
          extraId: String(e.extraId),
          cantidad: e.cantidad ?? 1,
        }));

        let extrasCobradoTotal = 0;
        const extrasJsonArr: any[] = [];
        const expanded: string[] = [];
        extrasNorm.forEach((e) => {
          for (let i = 0; i < e.cantidad; i++) expanded.push(e.extraId);
        });

        for (let idx = 0; idx < expanded.length; idx++) {
          const ex = extraMap.get(expanded[idx])!;
          const cobrado = idx >= LIMITE_EXTRAS_GRATIS;
          const precioExtra = cobrado ? ex.precio : 0;
          extrasCobradoTotal += precioExtra;
          extrasJsonArr.push({
            id: ex.id,
            nombre: ex.nombre,
            precio: ex.precio,
            cobrado,
          });
        }

        // Descuento stock extras
        for (const e of extrasNorm) {
          await tx.extra.update({
            where: { id: e.extraId },
            data: { stockActual: { decrement: e.cantidad } },
          });
        }

        const subtotal = precioUnitario * cantidad + extrasCobradoTotal;
        totalNuevosItems += subtotal;

        const extrasJson: Prisma.InputJsonValue | undefined =
          extrasJsonArr.length > 0 ? (extrasJsonArr as any) : undefined;

        const aderezosIds: string[] = Array.isArray(d.aderezosIds)
          ? d.aderezosIds
          : [];

        detallesCreate.push({
          cantidad,
          precioUnitario,
          extras: extrasJson,
          subtotal,
          notas: d.notas?.trim?.() || null,
          producto: { connect: { id: d.productoId } },
          aderezos:
            aderezosIds.length > 0
              ? { connect: aderezosIds.map((id) => ({ id })) }
              : undefined,
        });
      }

      const lineasParaCalcular = detalles.map((d: any) => ({
        productoId: d.productoId,
        cantidad: d.cantidad,
        precioUnitario: d.precioUnitario ?? prodMap.get(d.productoId)!.precio,
        extras: (d.extras || []).map((e: any) => ({
          extraId: e.extraId,
          cantidad: e.cantidad ?? 1,
          precio: extraMap.get(e.extraId)?.precio || 0,
        })),
      }));

      const calculoOfertas =
        await this.ofertasCalculator.calcularTotal(lineasParaCalcular);

      const totalConOfertas = totalNuevosItems - calculoOfertas.descuento;

      // -----------------------------
      // 4) Anexar o crear
      // -----------------------------
      const includeConfig = {
        detalles: {
          include: {
            producto: true,
            aderezos: true, // <-- Incluimos aderezos en la respuesta
          },
        },
      };

      if (pedidoId) {
        const pedido = await tx.pedido.findUnique({
          where: { id: pedidoId },
          select: {
            id: true,
            estado: true,
            nombreCliente: true,
            numeroCliente: true,
            metodoPago: true,
          },
        });

        if (!pedido) throw new NotFoundException('Pedido no encontrado');
        if (!ESTADOS_ABIERTOS.includes(pedido.estado))
          throw new BadRequestException('Pedido cerrado');

        const pedidoActualizado = await tx.pedido.update({
          where: { id: pedidoId },
          data: {
            total: { increment: totalConOfertas },
            detalles: { create: detallesCreate },
            ...(!pedido.nombreCliente && nombreClienteLimpio
              ? { nombreCliente: nombreClienteLimpio }
              : {}),
            ...(!pedido.numeroCliente && numeroClienteLimpio
              ? { numeroCliente: numeroClienteLimpio }
              : {}),
            ...(!pedido.metodoPago && metodoPago
              ? { metodoPago: metodoPago as MetodoPago }
              : {}),
          },
          include: includeConfig,
        });

        if (calculoOfertas.ofertasAplicadas.length > 0) {
          for (const ofertaAplicada of calculoOfertas.ofertasAplicadas) {
            await tx.pedidoOferta.create({
              data: {
                pedidoId: pedidoActualizado.id,
                ofertaId: ofertaAplicada.ofertaId,
                precioOriginal: calculoOfertas.subtotal,
                precioFinal: calculoOfertas.total,
                descuentoAplicado: ofertaAplicada.descuento,
              },
            });
            await tx.oferta.update({
              where: { id: ofertaAplicada.ofertaId },
              data: { usosActuales: { increment: 1 } },
            });
          }
        }

        return pedidoActualizado;
      }

      const pedidoNuevo = await tx.pedido.create({
        data: {
          tipo,
          nombreCliente: nombreClienteLimpio!,
          numeroCliente: numeroClienteLimpio,
          metodoPago: (metodoPago as MetodoPago) ?? null,
          direccion: tipo === TipoPedidoDto.DELIVERY ? direccion!.trim() : null,
          total: totalConOfertas,
          estado: EstadoPedido.PENDIENTE,
          detalles: { create: detallesCreate },
        },
        include: includeConfig,
      });

      if (calculoOfertas.ofertasAplicadas.length > 0) {
        for (const ofertaAplicada of calculoOfertas.ofertasAplicadas) {
          await tx.pedidoOferta.create({
            data: {
              pedidoId: pedidoNuevo.id,
              ofertaId: ofertaAplicada.ofertaId,
              precioOriginal: calculoOfertas.subtotal,
              precioFinal: calculoOfertas.total,
              descuentoAplicado: ofertaAplicada.descuento,
            },
          });
          await tx.oferta.update({
            where: { id: ofertaAplicada.ofertaId },
            data: { usosActuales: { increment: 1 } },
          });
        }
      }

      return pedidoNuevo;
    });
  }

  async listarTodos() {
    return this.prisma.pedido.findMany({
      include: {
        detalles: {
          include: {
            producto: true,
            aderezos: true,
          },
        },
        repartidor: { select: { nombre: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listarDeliveryPendientes() {
    return this.prisma.pedido.findMany({
      where: {
        tipo: TipoPedidoDto.DELIVERY,
        estado: { in: ESTADOS_ABIERTOS },
      },
      include: {
        detalles: { include: { producto: true } },
        repartidor: { select: { nombre: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async cambiarEstado(id: string, nuevoEstado: EstadoPedido) {
    const pedidoExistente = await this.prisma.pedido.findUnique({
      where: { id },
      select: { id: true, estado: true },
    });

    if (!pedidoExistente) {
      throw new NotFoundException(`El pedido con ID ${id} no existe`);
    }

    // Regla sana: si está ENTREGADO o CANCELADO no debería cambiar
    if (
      pedidoExistente.estado === EstadoPedido.ENTREGADO ||
      pedidoExistente.estado === EstadoPedido.CANCELADO
    ) {
      throw new BadRequestException(
        'No se puede cambiar estado de un pedido cerrado',
      );
    }

    return this.prisma.pedido.update({
      where: { id },
      data: { estado: nuevoEstado },
    });
  }

  // ✅ ahora finalizar = ENTREGADO
  async finalizarPedido(id: string) {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id },
      select: { id: true, estado: true },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    if (pedido.estado === EstadoPedido.ENTREGADO) {
      throw new BadRequestException('El pedido ya está entregado');
    }
    if (pedido.estado === EstadoPedido.CANCELADO) {
      throw new BadRequestException(
        'No se puede finalizar un pedido cancelado',
      );
    }

    return this.prisma.pedido.update({
      where: { id },
      data: { estado: EstadoPedido.ENTREGADO },
    });
  }

  async cancelarPedido(id: string, motivo: string, rol: Role) {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id },
      select: { id: true, estado: true },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    if (pedido.estado === EstadoPedido.CANCELADO) {
      throw new BadRequestException('El pedido ya estaba cancelado');
    }
    if (pedido.estado === EstadoPedido.ENTREGADO) {
      throw new BadRequestException('No se puede cancelar un pedido entregado');
    }

    const motivoLimpio = (motivo || '').trim();
    if (!motivoLimpio) throw new BadRequestException('Motivo obligatorio');

    return this.prisma.pedido.update({
      where: { id },
      data: {
        estado: EstadoPedido.CANCELADO,
        motivoCancelacion: motivoLimpio,
        canceladoPor: rol,
      },
    });
  }

  async setPago(id: string, dto: { metodoPago?: any; numeroCliente?: any }) {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id },
      select: { id: true, estado: true },
    });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    if (
      pedido.estado === EstadoPedido.ENTREGADO ||
      pedido.estado === EstadoPedido.CANCELADO
    ) {
      throw new BadRequestException(
        'No se puede cambiar pago de un pedido cerrado',
      );
    }

    return this.prisma.pedido.update({
      where: { id },
      data: {
        metodoPago: dto.metodoPago === undefined ? undefined : dto.metodoPago,
        numeroCliente:
          dto.numeroCliente === undefined
            ? undefined
            : dto.numeroCliente?.trim?.() || null,
      },
    });
  }
}
