import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreatePedidoDto, TipoPedidoDto } from './dto/create-pedido.dto';
import { EstadoPedido, Prisma, Role, MetodoPago } from '@prisma/client';
import { OfertasCalculatorService } from '../ofertas/ofertas-calculator.service';
import { NegocioConfigService } from '../config/config.service';
import { PedidosGateway } from './pedidos.gateway';

const ESTADOS_ABIERTOS: EstadoPedido[] = [
  EstadoPedido.PENDIENTE,
  EstadoPedido.EN_CAMINO,
];

const LIMITE_EXTRAS_GRATIS = 2;

@Injectable()
export class PedidosService {
  constructor(
    private prisma: PrismaService,
    private ofertasCalculator: OfertasCalculatorService,
    private configService: NegocioConfigService,
    private pedidosGateway: PedidosGateway,
  ) {}

  async crearPedido(dto: CreatePedidoDto) {
    const horaAperturaStr = await this.configService.obtener('hora_apertura');
    const horaCierreStr = await this.configService.obtener('hora_cierre');

    if (horaAperturaStr && horaCierreStr) {
      const ahora = new Date();
      const opciones: Intl.DateTimeFormatOptions = {
        timeZone: 'America/Argentina/Mendoza',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      };
      const horaActualStr = ahora.toLocaleTimeString('es-AR', opciones);
      const [horaActualHoras, horaActualMinutos] = horaActualStr.split(':').map(Number);
      const horaActual = horaActualHoras * 60 + horaActualMinutos;

      const [horaAp, minAp] = horaAperturaStr.split(':').map(Number);
      const [horaCi, minCi] = horaCierreStr.split(':').map(Number);
      const horaApertura = horaAp * 60 + (minAp || 0);
      const horaCierre = horaCi * 60 + (minCi || 0);

      if (horaActual < horaApertura || horaActual >= horaCierre) {
        throw new BadRequestException(
          `Estamos cerrados. Horario de atención: ${horaAperturaStr} a ${horaCierreStr}`,
        );
      }
    }

    const {
      tipo,
      direccion,
      detalles,
      pedidoId,
      nombreCliente,
      apellidoCliente,
      metodoPago,
      numeroCliente,
      costoEnvio,
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
    const apellidoClienteLimpio = apellidoCliente?.trim() || null;
    const numeroClienteLimpio = numeroCliente?.trim() || null;

    if (
      !pedidoId &&
      (!nombreClienteLimpio || nombreClienteLimpio.length === 0)
    ) {
      throw new BadRequestException('nombreCliente es obligatorio');
    }

    return this.prisma.$transaction(async (tx) => {
      const productoIds = detalles.map((d) => d.productoId);
      const productos = await tx.producto.findMany({
        where: { id: { in: productoIds } },
        select: {
          id: true,
          precio: true,
          activo: true,
          nombre: true,
          categoriaId: true,
          receta: {
            include: { insumo: { select: { id: true, stockActual: true } } },
          },
        },
      });

      const prodMap = new Map(
        productos.map((p) => [
          p.id,
          {
            precio: Number(p.precio),
            activo: Boolean(p.activo),
            nombre: p.nombre,
            categoriaId: p.categoriaId,
            receta: p.receta,
          },
        ]),
      );

      for (const pid of productoIds) {
        if (!prodMap.has(pid))
          throw new BadRequestException(`Producto no encontrado: ${pid}`);
        if (prodMap.get(pid)!.activo === false)
          throw new BadRequestException(`Producto inactivo: ${pid}`);
      }

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
              insumoId: true,
              preciosPorCategoria: true,
            },
          })
        : [];

      const extraMap = new Map(
        extrasDb.map((e) => [
          e.id,
          {
            ...e,
            precio: Number(e.precio),
            preciosPorCategoria: e.preciosPorCategoria,
          },
        ]),
      );

      const todosLosAderezosIds = detalles.flatMap(
        (d) => (d as any).aderezosIds ?? [],
      );

      const aderezosDb =
        todosLosAderezosIds.length > 0
          ? await tx.aderezo.findMany({
              where: { id: { in: todosLosAderezosIds } },
              select: {
                id: true,
                nombre: true,
                stockActual: true,
                activo: true,
              },
            })
          : [];

      const aderezoMap = new Map(
        aderezosDb.map((a) => [
          a.id,
          { ...a, stockActual: Number(a.stockActual) },
        ]),
      );

      for (const adeId of todosLosAderezosIds) {
        if (!aderezoMap.has(adeId)) {
          throw new BadRequestException(`Aderezo no encontrado: ${adeId}`);
        }
        const ade = aderezoMap.get(adeId)!;
        if (!ade.activo) {
          throw new BadRequestException(`Aderezo inactivo: ${ade.nombre}`);
        }
        if (ade.stockActual <= 0) {
          throw new BadRequestException(`Sin stock de aderezo: ${ade.nombre}`);
        }
      }

      const stockChecks: { insumoId: string; requerido: number }[] = [];

      for (const d of detalles as any[]) {
        const cantidad = Number(d.cantidad);
        const prod = prodMap.get(d.productoId)!;

        if (prod.receta && prod.receta.length > 0) {
          for (const recetaItem of prod.receta) {
            const requerido = recetaItem.cantidad * cantidad;
            stockChecks.push({
              insumoId: recetaItem.insumoId,
              requerido,
            });
          }
        }

        if (d.extras && Array.isArray(d.extras)) {
          for (const e of d.extras) {
            const extra = extraMap.get(e.extraId);
            if (!extra)
              throw new BadRequestException(
                `Extra no encontrado: ${e.extraId}`,
              );
            if (!extra.activo)
              throw new BadRequestException(`Extra inactivo: ${e.extraId}`);
            const cantidadExtra = e.cantidad ?? 1;

            const stockDisponible = extra.insumoId
              ? ((
                  await tx.insumo.findUnique({
                    where: { id: extra.insumoId },
                    select: { stockActual: true },
                  })
                )?.stockActual ?? 0)
              : extra.stockActual;

            if (stockDisponible < cantidadExtra) {
              throw new BadRequestException(
                `Stock insuficiente para extra ${extra.nombre}. Disponible: ${stockDisponible}`,
              );
            }
          }
        }

        const cantidadAderezos = d.aderezosIds?.length || 0;
        for (const adeId of d.aderezosIds || []) {
          const ade = aderezoMap.get(adeId);
          if (ade && ade.stockActual < cantidad) {
            throw new BadRequestException(
              `Stock insuficiente de aderezo ${ade.nombre}. Disponible: ${ade.stockActual}, Necesario: ${cantidad}`,
            );
          }
        }
      }

      const insumoIds = [...new Set(stockChecks.map((s) => s.insumoId))];
      const insumosActuales = await tx.insumo.findMany({
        where: { id: { in: insumoIds } },
        select: { id: true, stockActual: true, nombre: true },
      });

      const stockPorInsumo = new Map(
        insumosActuales.map((i) => [i.id, Number(i.stockActual)]),
      );

      const stockRequeridoPorInsumo = new Map<string, number>();
      for (const check of stockChecks) {
        const actual = stockRequeridoPorInsumo.get(check.insumoId) || 0;
        stockRequeridoPorInsumo.set(check.insumoId, actual + check.requerido);
      }

      for (const [insumoId, requerido] of stockRequeridoPorInsumo) {
        const disponible = stockPorInsumo.get(insumoId) || 0;
        if (disponible < requerido) {
          const insumo = insumosActuales.find((i) => i.id === insumoId);
          throw new BadRequestException(
            `Stock insuficiente de ${insumo?.nombre || insumoId}. Disponible: ${disponible}, Requerido: ${requerido}`,
          );
        }
      }

      let totalNuevosItems = 0;
      const detallesCreate: Prisma.PedidoDetalleCreateWithoutPedidoInput[] = [];

      const todosLosExtras: { extraId: string; cantidad: number }[] = [];
      const todosLosAderezosDescontar: {
        aderezoId: string;
        cantidad: number;
      }[] = [];

      for (const d of detalles as any[]) {
        const base = prodMap.get(d.productoId)!;
        const cantidad = Number(d.cantidad);
        const precioUnitario = d.precioUnitario ?? base.precio;
        const categoriaId = base.categoriaId;

        const extrasDto = Array.isArray(d.extras) ? d.extras : [];
        const sinExtras = d.sinExtras === true;

        const extrasNorm = extrasDto.map((e) => ({
          extraId: String(e.extraId),
          cantidad: e.cantidad ?? 1,
        }));

        todosLosExtras.push(...extrasNorm);

        let extrasCobradoTotal = 0;
        const extrasJsonArr: any[] = [];

        const expanded: { extraId: string; extra: any }[] = [];
        extrasNorm.forEach((e) => {
          const extra = extraMap.get(e.extraId);
          if (extra) {
            for (let i = 0; i < e.cantidad; i++) {
              expanded.push({ extraId: e.extraId, extra });
            }
          }
        });

        for (let idx = 0; idx < expanded.length; idx++) {
          const { extraId, extra } = expanded[idx];
          const precioExtra = this.getExtraPrecio(extra, categoriaId);
          const cobrado = idx >= LIMITE_EXTRAS_GRATIS;
          const precioFinal = cobrado ? precioExtra : 0;
          extrasCobradoTotal += precioFinal;
          extrasJsonArr.push({
            id: extraId,
            nombre: extra.nombre,
            precio: precioExtra,
            cobrado,
          });
        }

        const subtotal = precioUnitario * cantidad + extrasCobradoTotal;
        totalNuevosItems += subtotal;

        const extrasJson: Prisma.InputJsonValue | undefined =
          extrasJsonArr.length > 0 ? (extrasJsonArr as any) : undefined;

        const aderezosIds: string[] = Array.isArray(d.aderezosIds)
          ? d.aderezosIds
          : [];

        for (const adeId of aderezosIds) {
          todosLosAderezosDescontar.push({ aderezoId: adeId, cantidad });
        }

        detallesCreate.push({
          cantidad,
          precioUnitario,
          extras: extrasJson,
          subtotal,
          notas: d.notas?.trim?.() || null,
          sinExtras,
          producto: { connect: { id: d.productoId } },
          aderezos:
            aderezosIds.length > 0
              ? { connect: aderezosIds.map((id) => ({ id })) }
              : undefined,
        });
      }

      for (const e of todosLosExtras) {
        const extra = await tx.extra.findUnique({
          where: { id: e.extraId },
          select: { id: true, insumoId: true, stockActual: true, nombre: true },
        });

        if (!extra) {
          throw new BadRequestException(`Extra no encontrado: ${e.extraId}`);
        }

        if (extra.insumoId) {
          const result = await tx.insumo.updateMany({
            where: {
              id: extra.insumoId,
              stockActual: { gte: e.cantidad },
            },
            data: {
              stockActual: { decrement: e.cantidad },
            },
          });

          if (result.count === 0) {
            const insumo = await tx.insumo.findUnique({
              where: { id: extra.insumoId },
              select: { stockActual: true, nombre: true },
            });
            throw new BadRequestException(
              `Stock insuficiente para extra ${extra.nombre} (insumo: ${insumo?.nombre || extra.insumoId}). ` +
                `Disponible: ${insumo?.stockActual ?? 0}, Solicitado: ${e.cantidad}`,
            );
          }
        } else {
          const result = await tx.extra.updateMany({
            where: {
              id: e.extraId,
              stockActual: { gte: e.cantidad },
            },
            data: {
              stockActual: { decrement: e.cantidad },
            },
          });

          if (result.count === 0) {
            throw new BadRequestException(
              `Stock insuficiente para extra ${extra.nombre}. ` +
                `Disponible: ${extra.stockActual ?? 0}, Solicitado: ${e.cantidad}`,
            );
          }
        }
      }

      for (const item of todosLosAderezosDescontar) {
        const result = await tx.aderezo.updateMany({
          where: {
            id: item.aderezoId,
            stockActual: { gte: item.cantidad },
          },
          data: {
            stockActual: { decrement: item.cantidad },
          },
        });

        if (result.count === 0) {
          const ade = aderezoMap.get(item.aderezoId);
          throw new BadRequestException(
            `Stock insuficiente de aderezo ${ade?.nombre || item.aderezoId}. ` +
              `Disponible: ${ade?.stockActual ?? 0}, Necesario: ${item.cantidad}`,
          );
        }
      }

      for (const [insumoId, requerido] of stockRequeridoPorInsumo) {
        const result = await tx.insumo.updateMany({
          where: {
            id: insumoId,
            stockActual: { gte: requerido },
          },
          data: {
            stockActual: { decrement: requerido },
          },
        });

        if (result.count === 0) {
          const insumo = await tx.insumo.findUnique({
            where: { id: insumoId },
            select: { stockActual: true, nombre: true },
          });
          throw new BadRequestException(
            `Stock insuficiente de ${insumo?.nombre || insumoId}. ` +
              `Disponible: ${insumo?.stockActual ?? 0}, Requerido: ${requerido}`,
          );
        }
      }

      const lineasParaCalcular = detalles.map((d: any) => ({
        productoId: d.productoId,
        cantidad: d.cantidad,
        precioUnitario: d.precioUnitario ?? prodMap.get(d.productoId)!.precio,
        extras: (d.extras || []).map((e: any) => ({
          extraId: e.extraId,
          cantidad: e.cantidad ?? 1,
          precio: this.getExtraPrecio(
            extraMap.get(e.extraId),
            prodMap.get(d.productoId)?.categoriaId,
          ),
        })),
      }));

      const calculoOfertas =
        await this.ofertasCalculator.calcularTotal(lineasParaCalcular);

      const totalConOfertas = totalNuevosItems - calculoOfertas.descuento;

      const includeConfig = {
        detalles: {
          include: {
            producto: true,
            aderezos: true,
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
            apellidoCliente: true,
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
            ...(!pedido.apellidoCliente && apellidoClienteLimpio
              ? { apellidoCliente: apellidoClienteLimpio }
              : {}),
            ...(!pedido.numeroCliente && numeroClienteLimpio
              ? { numeroCliente: numeroClienteLimpio }
              : {}),
            ...(!pedido.metodoPago && metodoPago
              ? { metodoPago: metodoPago as MetodoPago }
              : {}),
            ...(costoEnvio !== undefined ? { costoEnvio } : {}),
          },
          include: includeConfig,
        });

        await this.registrarOfertasAplicadas(
          tx,
          pedidoActualizado.id,
          calculoOfertas,
        );

        this.pedidosGateway.notificarNuevoPedido({
          id: pedidoActualizado.id,
          nombreCliente: pedidoActualizado.nombreCliente || nombreClienteLimpio || '',
          apellidoCliente: pedidoActualizado.apellidoCliente || apellidoClienteLimpio || '',
          numeroCliente: pedidoActualizado.numeroCliente || numeroClienteLimpio || '',
          tipo,
          total: pedidoActualizado.total,
        });

        return pedidoActualizado;
      }

      const pedidoNuevo = await tx.pedido.create({
        data: {
          tipo,
          nombreCliente: nombreClienteLimpio!,
          apellidoCliente: apellidoClienteLimpio,
          metodoPago: (metodoPago as MetodoPago) ?? null,
          numeroCliente: numeroClienteLimpio,
          direccion: tipo === TipoPedidoDto.DELIVERY ? direccion!.trim() : null,
          costoEnvio: costoEnvio ?? 0,
          total: totalConOfertas,
          estado: EstadoPedido.PENDIENTE,
          detalles: { create: detallesCreate },
        },
        include: includeConfig,
      });

      await this.registrarOfertasAplicadas(tx, pedidoNuevo.id, calculoOfertas);

      this.pedidosGateway.notificarNuevoPedido({
        id: pedidoNuevo.id,
        nombreCliente: pedidoNuevo.nombreCliente || nombreClienteLimpio || '',
        apellidoCliente: pedidoNuevo.apellidoCliente || apellidoClienteLimpio || '',
        numeroCliente: pedidoNuevo.numeroCliente || numeroClienteLimpio || '',
        tipo,
        total: pedidoNuevo.total,
      });

      return pedidoNuevo;
    });
  }

  private getExtraPrecio(
    extra: any,
    categoriaId: string | null | undefined,
  ): number {
    if (!extra) return 0;

    if (extra.preciosPorCategoria && categoriaId) {
      const precioEspecifico = extra.preciosPorCategoria.find(
        (p: any) => p.categoriaId === categoriaId,
      );
      if (precioEspecifico) {
        return Number(precioEspecifico.precio);
      }
    }

    return Number(extra.precio);
  }

  private async registrarOfertasAplicadas(
    tx: Prisma.TransactionClient,
    pedidoId: string,
    calculoOfertas: any,
  ) {
    if (calculoOfertas.ofertasAplicadas.length > 0) {
      for (const ofertaAplicada of calculoOfertas.ofertasAplicadas) {
        await tx.pedidoOferta.create({
          data: {
            pedidoId,
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
        movimientosCaja: true,
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

  async findOne(id: string) {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id },
      include: {
        detalles: {
          include: {
            producto: { include: { categoria: true } },
            aderezos: true,
          },
        },
        repartidor: { select: { id: true, nombre: true } },
        movimientosCaja: true,
      },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    return pedido;
  }

  async cambiarEstado(id: string, nuevoEstado: EstadoPedido) {
    const pedidoExistente = await this.prisma.pedido.findUnique({
      where: { id },
      select: { id: true, estado: true },
    });

    if (!pedidoExistente) {
      throw new NotFoundException(`El pedido con ID ${id} no existe`);
    }

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
    return this.prisma.$transaction(async (tx) => {
      const pedido = await tx.pedido.findUnique({
        where: { id },
        select: {
          id: true,
          estado: true,
          detalles: {
            include: {
              producto: {
                select: {
                  id: true,
                  receta: {
                    include: { insumo: { select: { id: true } } },
                  },
                },
              },
              aderezos: { select: { id: true } },
            },
          },
        },
      });

      if (!pedido) throw new NotFoundException('Pedido no encontrado');

      if (pedido.estado === EstadoPedido.CANCELADO) {
        throw new BadRequestException('El pedido ya estaba cancelado');
      }
      if (pedido.estado === EstadoPedido.ENTREGADO) {
        throw new BadRequestException(
          'No se puede cancelar un pedido entregado',
        );
      }

      const motivoLimpio = (motivo || '').trim();
      if (!motivoLimpio) throw new BadRequestException('Motivo obligatorio');

      for (const detalle of pedido.detalles) {
        const extrasJson = detalle.extras as any[] | null;
        if (extrasJson && Array.isArray(extrasJson)) {
          const extrasCount = new Map<string, number>();
          for (const ex of extrasJson) {
            const count = extrasCount.get(ex.id) || 0;
            extrasCount.set(ex.id, count + 1);
          }
          for (const [extraId, count] of extrasCount) {
            const extra = await tx.extra.findUnique({
              where: { id: extraId },
              select: { insumoId: true },
            });

            if (extra?.insumoId) {
              await tx.insumo.update({
                where: { id: extra.insumoId },
                data: { stockActual: { increment: count } },
              });
            } else {
              await tx.extra.update({
                where: { id: extraId },
                data: { stockActual: { increment: count } },
              });
            }
          }
        }

        if (detalle.aderezos && detalle.aderezos.length > 0) {
          for (const aderezo of detalle.aderezos) {
            await tx.aderezo.update({
              where: { id: aderezo.id },
              data: { stockActual: { increment: detalle.cantidad } },
            });
          }
        }

        if (detalle.producto.receta && detalle.producto.receta.length > 0) {
          for (const recetaItem of detalle.producto.receta) {
            const cantidadRestaurar = recetaItem.cantidad * detalle.cantidad;
            await tx.insumo.update({
              where: { id: recetaItem.insumoId },
              data: { stockActual: { increment: cantidadRestaurar } },
            });
          }
        }
      }

      return tx.pedido.update({
        where: { id },
        data: {
          estado: EstadoPedido.CANCELADO,
          motivoCancelacion: motivoLimpio,
          canceladoPor: rol,
        },
      });
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

  async setCostoEnvio(id: string, costoEnvio: number) {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id },
      select: { id: true, estado: true, tipo: true },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    if (
      pedido.estado === EstadoPedido.ENTREGADO ||
      pedido.estado === EstadoPedido.CANCELADO
    ) {
      throw new BadRequestException(
        'No se puede modificar el costo de envío de un pedido cerrado',
      );
    }

    const costoEnvioNum = Number(costoEnvio);
    if (!Number.isFinite(costoEnvioNum) || costoEnvioNum < 0) {
      throw new BadRequestException(
        'El costo de envío debe ser un número válido mayor o igual a 0',
      );
    }

    return this.prisma.pedido.update({
      where: { id },
      data: { costoEnvio: costoEnvioNum },
    });
  }
}
