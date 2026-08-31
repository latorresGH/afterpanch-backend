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
          data: dto.productos.map((p, idx) => ({
            ofertaId: oferta.id,
            productoId: p.productoId,
            obligatorio: p.obligatorio ?? false,
            cantidadMin: p.cantidadMin ?? 1,
            cantidadMax: p.cantidadMax ?? null,
            precioEspecial: p.precioEspecial ?? null,
            orden: p.orden ?? idx,
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
            data: dto.productos.map((p, idx) => ({
              ofertaId: id,
              productoId: p.productoId,
              obligatorio: p.obligatorio ?? false,
              cantidadMin: p.cantidadMin ?? 1,
              cantidadMax: p.cantidadMax ?? null,
              precioEspecial: p.precioEspecial ?? null,
              orden: p.orden ?? idx,
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

  /**
   * La oferta que está corriendo ahora mismo y antes deja de correr.
   *
   * Sirve al aviso "HH:MM vence la promo de hoy" del Home. La vigencia se
   * evalúa con el MISMO criterio que `OfertasCalculatorService.calcularTotal`,
   * que es el que decide si un descuento se aplica de verdad: estado ACTIVA +
   * `activa` + dentro de `fechaInicio`/`fechaFin` + el día en `diasAplicables`
   * + dentro de la franja horaria. Si los dos criterios se separaran, el Home
   * anunciaria una promo que la caja no aplica.
   *
   * Ojo con la franja: el calculador solo la respeta cuando estan cargadas
   * `horaInicio` Y `horaFin`. Una oferta con `horaFin` sola corre todo el dia,
   * asi que esa hora no es un vencimiento real y no se muestra como tal: en
   * ese caso el unico corte posible es `fechaFin`, si cae hoy.
   *
   * Devuelve `null` cuando no hay ninguna vigente. Devuelve `hasta: null`
   * cuando hay una vigente que hoy no se corta por hora (arranca y termina
   * con el dia): el Home muestra el estado "sin vencimiento" y no inventa una
   * hora.
   */
  async getVigenteConVencimiento(ahora: Date = new Date()): Promise<{
    id: string;
    nombre: string;
    /** `HH:MM` en que deja de estar vigente, o null si hoy no se corta. */
    hasta: string | null;
    /** Minutos hasta ese corte. null cuando `hasta` es null. */
    minutosRestantes: number | null;
  } | null> {
    const diaSemana = ahora.getDay() === 0 ? 7 : ahora.getDay();
    const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();

    const candidatas = await this.prisma.oferta.findMany({
      where: {
        activa: true,
        estado: EstadoOferta.ACTIVA,
        fechaInicio: { lte: ahora },
        OR: [{ fechaFin: null }, { fechaFin: { gte: ahora } }],
      },
      select: {
        id: true,
        nombre: true,
        diasAplicables: true,
        horaInicio: true,
        horaFin: true,
        fechaFin: true,
      },
      orderBy: { orden: 'asc' },
    });

    let mejor: {
      id: string;
      nombre: string;
      hasta: string | null;
      minutosRestantes: number | null;
    } | null = null;

    for (const oferta of candidatas) {
      const dias = oferta.diasAplicables
        .split(',')
        .map((d) => parseInt(d.trim(), 10));
      if (!dias.includes(diaSemana)) continue;

      const franja = this.franjaEnMinutos(oferta.horaInicio, oferta.horaFin);

      // Misma regla que el calculador: sin franja completa, corre todo el dia.
      if (franja && !this.dentroDeFranja(franja, minutosAhora)) continue;

      const corte = this.proximoCorte(franja, oferta.fechaFin, ahora, minutosAhora);

      // La que vence antes gana. Una sin corte solo queda si no hay ninguna
      // con corte: es informacion mas pobre, no puede tapar a una que si vence.
      if (
        mejor === null ||
        (corte !== null &&
          (mejor.minutosRestantes === null ||
            corte.minutosRestantes < mejor.minutosRestantes))
      ) {
        mejor = {
          id: oferta.id,
          nombre: oferta.nombre,
          hasta: corte?.hasta ?? null,
          minutosRestantes: corte?.minutosRestantes ?? null,
        };
      }
    }

    return mejor;
  }

  /** `"20:00"`/`"23:59"` -> minutos desde medianoche. null si falta alguna. */
  private franjaEnMinutos(
    horaInicio: string | null,
    horaFin: string | null,
  ): { inicio: number; fin: number } | null {
    if (!horaInicio || !horaFin) return null;

    const aMinutos = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number);
      if (!Number.isFinite(h)) return null;
      return h * 60 + (Number.isFinite(m) ? m : 0);
    };

    const inicio = aMinutos(horaInicio);
    const fin = aMinutos(horaFin);
    if (inicio === null || fin === null) return null;

    return { inicio, fin };
  }

  /** Copia exacta de la condicion del calculador, incluido cruzar medianoche. */
  private dentroDeFranja(
    franja: { inicio: number; fin: number },
    minutosAhora: number,
  ): boolean {
    const cruzaMedianoche = franja.fin < franja.inicio;

    if (cruzaMedianoche) {
      return !(minutosAhora < franja.inicio && minutosAhora >= franja.fin);
    }

    return minutosAhora >= franja.inicio && minutosAhora <= franja.fin;
  }

  /**
   * Cuando deja de correr: lo que pase primero entre el fin de la franja
   * horaria y `fechaFin`. Devuelve null si no hay ninguno de los dos.
   */
  private proximoCorte(
    franja: { inicio: number; fin: number } | null,
    fechaFin: Date | null,
    ahora: Date,
    minutosAhora: number,
  ): { hasta: string; minutosRestantes: number } | null {
    const cortes: { hasta: string; minutosRestantes: number }[] = [];

    if (franja) {
      // Si cruza medianoche y ya pasamos el arranque, el corte es manana.
      const cruzaMedianoche = franja.fin < franja.inicio;
      const restantes =
        cruzaMedianoche && minutosAhora >= franja.inicio
          ? 24 * 60 - minutosAhora + franja.fin
          : franja.fin - minutosAhora;

      cortes.push({
        hasta: this.formatoHoraMinuto(franja.fin),
        minutosRestantes: restantes,
      });
    }

    if (fechaFin) {
      const restantes = Math.floor(
        (fechaFin.getTime() - ahora.getTime()) / 60000,
      );
      cortes.push({
        hasta: this.formatoHoraMinuto(
          fechaFin.getHours() * 60 + fechaFin.getMinutes(),
        ),
        minutosRestantes: restantes,
      });
    }

    if (cortes.length === 0) return null;

    return cortes.reduce((a, b) =>
      b.minutosRestantes < a.minutosRestantes ? b : a,
    );
  }

  /** 1439 -> `"23:59"`. */
  private formatoHoraMinuto(minutos: number): string {
    const normalizado = ((minutos % 1440) + 1440) % 1440;
    const h = Math.floor(normalizado / 60);
    const m = normalizado % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
