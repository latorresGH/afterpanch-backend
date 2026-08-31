import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { EstadoPedido, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

import { CreateProductoDto } from './dto/create-producto.dto';
import { RecetaItemDto } from './dto/receta-item.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { disponibilidadDe } from './disponibilidad';

/**
 * Lo unico que sale por el endpoint publico del menu.
 *
 * Es un `select` explicito y no un `omit`: si manana el modelo suma una
 * columna interna (costo, margen, proveedor), no se filtra sola al menu.
 * Queda afuera todo lo que un visitante sin login no tiene por que ver: la
 * receta, el stock de cada insumo y el codigo interno.
 */
const SELECT_MENU_PUBLICO = {
  id: true,
  nombre: true,
  precio: true,
  descripcion: true,
  imagenUrl: true,
  activo: true,
  categoriaId: true,
  categoria: { select: { id: true, nombre: true, orden: true } },
  // Se trae para calcular la disponibilidad y se descarta antes de responder:
  // nunca viaja al cliente.
  receta: {
    select: {
      cantidad: true,
      insumo: { select: { stockActual: true } },
    },
  },
} satisfies Prisma.ProductoSelect;

/** Vista completa de gestion: producto + categoria + receta con su insumo. */
const INCLUDE_COMPLETO = {
  categoria: true,
  receta: { include: { insumo: true } },
} satisfies Prisma.ProductoInclude;

@Injectable()
export class ProductosService {
  constructor(private prisma: PrismaService) {}

  async crearProductoConReceta(datos: CreateProductoDto) {
    // validar categoría existe
    const cat = await this.prisma.categoria.findUnique({
      where: { id: datos.categoriaId },
      select: { id: true },
    });
    if (!cat) throw new BadRequestException('Categoría inválida');

    const receta = await this.validarReceta(datos.receta);

    return this.prisma.producto.create({
      data: {
        nombre: datos.nombre.trim(),
        precio: Number(datos.precio),
        descripcion: datos.descripcion ?? null,
        imagenUrl: datos.imagenUrl ?? null,
        codigo: datos.codigo ?? null,
        tiempoPreparacionMin:
          datos.tiempoPreparacionMin !== undefined &&
          datos.tiempoPreparacionMin !== null
            ? Number(datos.tiempoPreparacionMin)
            : null,
        activo: true,
        categoria: { connect: { id: datos.categoriaId } },
        receta: { create: receta },
      },
      include: INCLUDE_COMPLETO,
    });
  }

  /**
   * El menu que ve cualquiera, sin login.
   *
   * Devuelve solo productos activos y solo campos publicos. La unica cuenta
   * que hace es la disponibilidad, que antes resolvia el navegador con la
   * receta y el stock de todos los insumos en la mano.
   */
  async obtenerMenuPublico() {
    const productos = await this.prisma.producto.findMany({
      where: { activo: true },
      select: SELECT_MENU_PUBLICO,
      orderBy: [{ categoria: { orden: 'asc' } }, { nombre: 'asc' }],
    });

    return productos.map(({ receta, ...producto }) => ({
      ...producto,
      ...disponibilidadDe(receta),
    }));
  }

  /**
   * Vista completa (receta, stock de cada insumo, codigo interno, pausados).
   * Es la que consume el personal: POS y los modales de gestion. No es
   * publica.
   */
  async obtenerMenuCompleto(incluirInactivos = false) {
    return this.prisma.producto.findMany({
      where: incluirInactivos ? {} : { activo: true },
      include: INCLUDE_COMPLETO,
      orderBy: [{ categoria: { orden: 'asc' } }, { nombre: 'asc' }],
    });
  }

  async findOne(id: string) {
    const prod = await this.prisma.producto.findUnique({
      where: { id },
      include: INCLUDE_COMPLETO,
    });
    if (!prod) throw new NotFoundException('Producto no encontrado');
    return prod;
  }

  async update(id: string, dto: UpdateProductoDto) {
    await this.ensureExists(id);

    const { receta, categoriaId, ...productoData } = dto;

    // validar categoriaId si viene y no es vacío ni null
    if (categoriaId && categoriaId !== null) {
      const cat = await this.prisma.categoria.findUnique({
        where: { id: categoriaId },
        select: { id: true },
      });
      if (!cat) throw new BadRequestException('Categoría inválida');
    }

    // Fuera de la transacción a propósito: son lecturas, y si la receta viene
    // mal no tiene sentido haber abierto nada.
    const recetaValidada = Array.isArray(receta)
      ? await this.validarReceta(receta)
      : null;

    return this.prisma.$transaction(async (tx) => {
      await tx.producto.update({
        where: { id },
        data: {
          nombre:
            productoData.nombre !== undefined
              ? String(productoData.nombre).trim()
              : undefined,

          precio:
            productoData.precio !== undefined
              ? Number(productoData.precio)
              : undefined,

          descripcion:
            productoData.descripcion !== undefined
              ? productoData.descripcion === null
                ? null
                : String(productoData.descripcion)
              : undefined,

          imagenUrl:
            productoData.imagenUrl !== undefined
              ? productoData.imagenUrl === null || productoData.imagenUrl === ''
                ? null
                : String(productoData.imagenUrl)
              : undefined,

          codigo:
            productoData.codigo !== undefined
              ? productoData.codigo === ''
                ? null
                : String(productoData.codigo)
              : undefined,

          tiempoPreparacionMin:
            productoData.tiempoPreparacionMin !== undefined
              ? productoData.tiempoPreparacionMin === null
                ? null
                : Number(productoData.tiempoPreparacionMin)
              : undefined,

          categoria:
            categoriaId !== undefined
              ? categoriaId
                ? { connect: { id: categoriaId } }
                : { disconnect: true }
              : undefined,
        },
      });

      if (recetaValidada) {
        await tx.productoReceta.deleteMany({ where: { productoId: id } });

        if (recetaValidada.length > 0) {
          await tx.productoReceta.createMany({
            data: recetaValidada.map((r) => ({ productoId: id, ...r })),
          });
        }
      }

      return tx.producto.findUnique({
        where: { id },
        include: INCLUDE_COMPLETO,
      });
    });
  }

  async setActivo(id: string, activo: boolean) {
    await this.ensureExists(id);

    return this.prisma.producto.update({
      where: { id },
      data: { activo: Boolean(activo) },
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);

    const usadoEnPedidos = await this.prisma.pedidoDetalle.count({
      where: { productoId: id },
    });

    if (usadoEnPedidos > 0) {
      throw new BadRequestException(
        'No se puede borrar un producto que ya fue usado en pedidos. Usá baja lógica (activo=false).',
      );
    }

    await this.prisma.productoReceta.deleteMany({ where: { productoId: id } });

    return this.prisma.producto.delete({ where: { id } });
  }

  async getStats(productoId: string, fechaInicio: string, fechaFin: string) {
    const producto = await this.prisma.producto.findUnique({
      where: { id: productoId },
      select: { id: true, nombre: true },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');

    const inicio = new Date(`${fechaInicio}T00:00:00`);
    const fin = new Date(`${fechaFin}T23:59:59.999`);

    const resultado = await this.prisma.pedidoDetalle.aggregate({
      where: {
        productoId,
        pedido: {
          estado: EstadoPedido.ENTREGADO,
          createdAt: { gte: inicio, lte: fin },
        },
      },
      _sum: {
        cantidad: true,
        subtotal: true,
      },
    });

    return {
      productoId,
      nombre: producto.nombre,
      cantidadVendida: resultado._sum.cantidad ?? 0,
      totalRecaudado: resultado._sum.subtotal ?? 0,
      fechaInicio,
      fechaFin,
    };
  }

  /**
   * Los chequeos de la receta que el DTO no puede hacer solo.
   *
   * Son dos, y los dos terminaban en un 500 o en datos corruptos:
   *
   * - Insumo repetido. La base ahora lo rechaza (unique productoId+insumoId),
   *   pero el error de Prisma no le dice nada a nadie: mejor un 400 que nombre
   *   el insumo. Importa porque la venta recorre la receta linea por linea, y
   *   dos lineas del mismo insumo descontaban el stock dos veces.
   * - Insumo inexistente. Antes reventaba como violacion de foreign key.
   */
  private async validarReceta(
    receta: RecetaItemDto[] | undefined,
  ): Promise<{ insumoId: string; cantidad: number }[]> {
    const items = (receta ?? []).map((r) => ({
      insumoId: r.insumoId,
      cantidad: Number(r.cantidad),
    }));

    if (items.length === 0) return [];

    // El DTO ya lo valida; esto cubre las llamadas internas que no pasan por
    // el ValidationPipe.
    const invalida = items.find((r) => !(r.cantidad > 0));
    if (invalida) {
      throw new BadRequestException(
        `La cantidad de la receta debe ser mayor a cero (insumo ${invalida.insumoId}).`,
      );
    }

    const vistos = new Set<string>();
    const repetidos = new Set<string>();
    for (const item of items) {
      if (vistos.has(item.insumoId)) repetidos.add(item.insumoId);
      vistos.add(item.insumoId);
    }
    if (repetidos.size > 0) {
      throw new BadRequestException(
        `La receta repite insumos (${[...repetidos].join(', ')}). Cada insumo entra una sola vez, con la cantidad total.`,
      );
    }

    const ids = [...vistos];
    const existentes = await this.prisma.insumo.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });

    if (existentes.length !== ids.length) {
      const encontrados = new Set(existentes.map((i) => i.id));
      const faltantes = ids.filter((id) => !encontrados.has(id));
      throw new BadRequestException(
        `La receta usa insumos que no existen: ${faltantes.join(', ')}.`,
      );
    }

    return items;
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.producto.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Producto no encontrado');
  }
}
