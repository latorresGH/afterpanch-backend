import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOfertaDto } from './dto/create-oferta.dto';
import { UpdateOfertaDto } from './dto/update-oferta.dto';
import { EstadoOferta, TipoOferta } from '@prisma/client';

@Injectable()
export class OfertasService {
  constructor(private prisma: PrismaService) {}

  private parseFechaLocal(fechaStr: string): Date {
    const [year, month, day] = fechaStr.split('-').map(Number);
    return new Date(year, month - 1, day, 0, 0, 0, 0);
  }

  async crear(dto: CreateOfertaDto) {
    if (
      dto.tipo === TipoOferta.DESCUENTO_PORCENTAJE &&
      !dto.porcentajeDescuento
    ) {
      throw new BadRequestException(
        'porcentajeDescuento es requerido para DESCUENTO_PORCENTAJE',
      );
    }

    if (dto.tipo === TipoOferta.DESCUENTO_MONTO_FIJO && !dto.montoDescuento) {
      throw new BadRequestException(
        'montoDescuento es requerido para DESCUENTO_MONTO_FIJO',
      );
    }

    // Combos (modelo nuevo B1): lista fija de productos ordenada + precio fijo.
    // GrupoCombo quedó deprecado; ya no se exige.
    if (dto.tipo === TipoOferta.COMBO) {
      if (dto.precio === undefined || dto.precio === null || dto.precio <= 0) {
        throw new BadRequestException(
          'precio (precio fijo del combo) es requerido y debe ser mayor a 0 para COMBO',
        );
      }
      if (!dto.productos || dto.productos.length === 0) {
        throw new BadRequestException(
          'productos (lista de productos del combo) es requerido para COMBO',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const oferta = await tx.oferta.create({
        data: {
          nombre: dto.nombre.trim(),
          descripcion: dto.descripcion?.trim() || null,
          tipo: dto.tipo,
          estado: dto.estado || EstadoOferta.ACTIVA,
          fechaInicio: this.parseFechaLocal(dto.fechaInicio),
          fechaFin: dto.fechaFin ? this.parseFechaLocal(dto.fechaFin) : null,
          activa: dto.activa ?? true,
          porcentajeDescuento: dto.porcentajeDescuento ?? null,
          montoDescuento: dto.montoDescuento ?? null,
          precio: dto.precio ?? null,
          imagenUrl: dto.imagenUrl?.trim() || null,
          orden: dto.orden ?? 0,
          maxUsosPorCliente: dto.maxUsosPorCliente ?? null,
          maxUsosTotales: dto.maxUsosTotales ?? null,
          diasAplicables: dto.diasAplicables || '1,2,3,4,5,6,7',
          horaInicio: dto.horaInicio || null,
          horaFin: dto.horaFin || null,
          aplicaPorLinea: dto.aplicaPorLinea ?? true,
        },
      });

      if (dto.productos && dto.productos.length > 0) {
        await tx.ofertaProducto.createMany({
          data: dto.productos.map((p) => ({
            ofertaId: oferta.id,
            productoId: p.productoId,
            obligatorio: p.obligatorio ?? false,
            cantidadMin: p.cantidadMin ?? 1,
            cantidadMax: p.cantidadMax ?? null,
            precioEspecial: p.precioEspecial ?? null,
            orden: p.orden ?? 0,
          })),
        });
      }

      if (dto.gruposCombo && dto.gruposCombo.length > 0) {
        for (const grupo of dto.gruposCombo) {
          const grupoCreado = await tx.grupoCombo.create({
            data: {
              ofertaId: oferta.id,
              nombre: grupo.nombre,
              obligatorio: grupo.obligatorio ?? true,
              cantidad: grupo.cantidad,
            },
          });

          await tx.grupoOpcion.createMany({
            data: grupo.opciones.map((op) => ({
              grupoComboId: grupoCreado.id,
              productoId: op.productoId,
            })),
          });
        }
      }

      return tx.oferta.findUnique({
        where: { id: oferta.id },
        include: {
          productos: { include: { producto: true } },
          gruposCombo: {
            include: { opciones: { include: { producto: true } } },
          },
        },
      });
    });
  }

  async findAll(soloActivas = false) {
    return this.prisma.oferta.findMany({
      where: soloActivas ? { activa: true } : {},
      include: {
        productos: { include: { producto: true } },
        gruposCombo: { include: { opciones: { include: { producto: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Endpoint público del menú: combos activos con su lista fija de productos ordenada.
  // NOTA: la categoría expone `cantExtrasGratis` (límite real de extras gratis del proyecto;
  // no existe un campo `maxAderezosGratis` — los aderezos son gratis sin límite).
  async findCombos() {
    return this.prisma.oferta.findMany({
      where: {
        tipo: TipoOferta.COMBO,
        activa: true,
      },
      select: {
        id: true,
        nombre: true,
        descripcion: true,
        precio: true,
        imagenUrl: true,
        orden: true,
        productos: {
          orderBy: { orden: 'asc' },
          select: {
            orden: true,
            producto: {
              select: {
                id: true,
                nombre: true,
                precio: true,
                imagenUrl: true,
                categoria: {
                  select: {
                    id: true,
                    nombre: true,
                    sinExtrasNiAderezos: true,
                    cantExtrasGratis: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { orden: 'asc' },
    });
  }

  async findOne(id: string) {
    const oferta = await this.prisma.oferta.findUnique({
      where: { id },
      include: {
        productos: { include: { producto: true } },
        gruposCombo: { include: { opciones: { include: { producto: true } } } },
      },
    });

    if (!oferta) {
      throw new NotFoundException('Oferta no encontrada');
    }

    return oferta;
  }

  async update(id: string, dto: UpdateOfertaDto) {
    await this.findOne(id);

    return this.prisma.$transaction(async (tx) => {
      const oferta = await tx.oferta.update({
        where: { id },
        data: {
          nombre: dto.nombre?.trim(),
          descripcion: dto.descripcion?.trim() || null,
          estado: dto.estado,
          fechaInicio: dto.fechaInicio ? this.parseFechaLocal(dto.fechaInicio) : undefined,
          fechaFin: dto.fechaFin ? this.parseFechaLocal(dto.fechaFin) : undefined,
          activa: dto.activa,
          porcentajeDescuento: dto.porcentajeDescuento,
          montoDescuento: dto.montoDescuento,
          precio: dto.precio,
          imagenUrl: dto.imagenUrl,
          orden: dto.orden,
          maxUsosPorCliente: dto.maxUsosPorCliente,
          maxUsosTotales: dto.maxUsosTotales,
          diasAplicables: dto.diasAplicables,
          horaInicio: dto.horaInicio,
          horaFin: dto.horaFin,
          aplicaPorLinea: dto.aplicaPorLinea,
        },
      });

      if (dto.productos !== undefined) {
        await tx.ofertaProducto.deleteMany({ where: { ofertaId: id } });

        if (dto.productos.length > 0) {
          await tx.ofertaProducto.createMany({
            data: dto.productos.map((p) => ({
              ofertaId: id,
              productoId: p.productoId,
              obligatorio: p.obligatorio ?? false,
              cantidadMin: p.cantidadMin ?? 1,
              cantidadMax: p.cantidadMax ?? null,
              precioEspecial: p.precioEspecial ?? null,
            })),
          });
        }
      }

      if (dto.gruposCombo !== undefined) {
        await tx.grupoOpcion.deleteMany({
          where: { grupoCombo: { ofertaId: id } },
        });
        await tx.grupoCombo.deleteMany({ where: { ofertaId: id } });

        if (dto.gruposCombo.length > 0) {
          for (const grupo of dto.gruposCombo) {
            const grupoCreado = await tx.grupoCombo.create({
              data: {
                ofertaId: id,
                nombre: grupo.nombre,
                obligatorio: grupo.obligatorio ?? true,
                cantidad: grupo.cantidad,
              },
            });

            await tx.grupoOpcion.createMany({
              data: grupo.opciones.map((op) => ({
                grupoComboId: grupoCreado.id,
                productoId: op.productoId,
              })),
            });
          }
        }
      }

      return tx.oferta.findUnique({
        where: { id },
        include: {
          productos: { include: { producto: true } },
          gruposCombo: {
            include: { opciones: { include: { producto: true } } },
          },
        },
      });
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.$transaction(async (tx) => {
      await tx.pedidoOferta.deleteMany({ where: { ofertaId: id } });
      await tx.grupoOpcion.deleteMany({
        where: { grupoCombo: { ofertaId: id } },
      });
      await tx.grupoCombo.deleteMany({ where: { ofertaId: id } });
      await tx.ofertaProducto.deleteMany({ where: { ofertaId: id } });

      return tx.oferta.delete({ where: { id } });
    });
  }

  async setActiva(id: string, activa: boolean) {
    await this.findOne(id);

    return this.prisma.oferta.update({
      where: { id },
      data: { activa },
    });
  }

  async incrementarUso(id: string) {
    return this.prisma.oferta.update({
      where: { id },
      data: { usosActuales: { increment: 1 } },
    });
  }
}
