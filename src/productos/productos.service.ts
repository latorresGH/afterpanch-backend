import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class ProductosService {
  constructor(private prisma: PrismaService) {}

  async crearProductoConReceta(datos: any) {
    // validar categoría existe
    const cat = await this.prisma.categoria.findUnique({
      where: { id: datos.categoriaId },
      select: { id: true },
    });
    if (!cat) throw new BadRequestException('Categoría inválida');

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
        receta: {
          create: (datos.receta ?? []).map((r: any) => ({
            insumoId: r.insumoId,
            cantidad: Number(r.cantidad),
          })),
        },
      },
      include: {
        categoria: true,
        receta: { include: { insumo: true } },
      },
    });
  }

  async obtenerMenu(incluirInactivos = false) {
    return this.prisma.producto.findMany({
      where: incluirInactivos ? {} : { activo: true },
      include: {
        categoria: true,
        receta: { include: { insumo: true } },
      },
      orderBy: [{ categoria: { orden: 'asc' } }, { nombre: 'asc' }],
    });
  }

  async findOne(id: string) {
    const prod = await this.prisma.producto.findUnique({
      where: { id },
      include: {
        categoria: true,
        receta: { include: { insumo: true } },
      },
    });
    if (!prod) throw new NotFoundException('Producto no encontrado');
    return prod;
  }

  async update(id: string, dto: any) {
    await this.ensureExists(id);

    const { receta, categoriaId, ...productoData } = dto;

    // validar categoriaId si viene y no es vacío
    if (categoriaId) {
      const cat = await this.prisma.categoria.findUnique({
        where: { id: categoriaId },
        select: { id: true },
      });
      if (!cat) throw new BadRequestException('Categoría inválida');
    }

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

      if (Array.isArray(receta)) {
        await tx.productoReceta.deleteMany({ where: { productoId: id } });

        if (receta.length > 0) {
          await tx.productoReceta.createMany({
            data: receta.map((r: any) => ({
              productoId: id,
              insumoId: r.insumoId,
              cantidad: Number(r.cantidad),
            })),
          });
        }
      }

      return tx.producto.findUnique({
        where: { id },
        include: {
          categoria: true,
          receta: { include: { insumo: true } },
        },
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

  private async ensureExists(id: string) {
    const exists = await this.prisma.producto.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Producto no encontrado');
  }
}
