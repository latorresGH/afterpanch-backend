import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateInsumoDto } from './dto/update-insumo.dto';

@Injectable()
export class InsumosService {
  constructor(private prisma: PrismaService) {}

  async crear(
    nombre: string,
    stockInicial: number,
    unidad: string,
    proveedorId: string | null,
  ) {
    return this.prisma.insumo.create({
      data: {
        nombre: nombre.trim(),
        stockActual: Number(stockInicial),
        unidadMedida: unidad.trim(),
        activo: true,
        proveedor: proveedorId ? { connect: { id: proveedorId } } : undefined,
      },
      include: { proveedor: true },
    });
  }

  async obtenerTodo(incluirInactivos = false) {
    return this.prisma.insumo.findMany({
      where: incluirInactivos ? {} : { activo: true },
      include: { proveedor: true },
      orderBy: { nombre: 'asc' },
    });
  }

  async obtener(id: string) {
    const insumo = await this.prisma.insumo.findUnique({
      where: { id },
      include: { proveedor: true },
    });
    if (!insumo) throw new NotFoundException('Insumo no encontrado');
    return insumo;
  }

  async actualizar(id: string, dto: UpdateInsumoDto) {
    await this.ensureExists(id);

    const { proveedorId, ...rest } = dto;

    return this.prisma.insumo.update({
      where: { id },
      data: {
        ...rest,
        nombre: rest.nombre !== undefined ? rest.nombre.trim() : undefined,
        unidadMedida:
          rest.unidadMedida !== undefined
            ? rest.unidadMedida.trim()
            : undefined,

        // ✅ asignar / quitar proveedor
        proveedor:
          proveedorId !== undefined
            ? proveedorId
              ? { connect: { id: proveedorId } }
              : { disconnect: true }
            : undefined,
      },
      include: { proveedor: true },
    });
  }

  async sumarStock(id: string, cantidad: number) {
    await this.ensureExists(id);

    const cant = Number(cantidad);
    if (!Number.isFinite(cant) || cant <= 0) {
      throw new BadRequestException('Cantidad inválida');
    }

    return this.prisma.insumo.update({
      where: { id },
      data: { stockActual: { increment: cant } },
      include: { proveedor: true },
    });
  }

  async setActivo(id: string, activo: boolean) {
    await this.ensureExists(id);

    return this.prisma.insumo.update({
      where: { id },
      data: { activo: Boolean(activo) },
    });
  }

  // ✅ borrar real (solo si no está usado en ninguna receta)
  async borrar(id: string) {
    await this.ensureExists(id);

    const usadoEnRecetas = await this.prisma.productoReceta.count({
      where: { insumoId: id },
    });

    if (usadoEnRecetas > 0) {
      throw new BadRequestException(
        'No se puede borrar un insumo que está en recetas. Usá baja lógica (activo=false).',
      );
    }

    return this.prisma.insumo.delete({ where: { id } });
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.insumo.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Insumo no encontrado');
  }

  async descontarStock(id: string, cantidad: number) {
    const cant = Number(cantidad);
    if (!Number.isFinite(cant) || cant <= 0) {
      throw new BadRequestException('Cantidad inválida');
    }

    // 1) Traer insumo actual
    const insumo = await this.prisma.insumo.findUnique({
      where: { id },
      select: { id: true, stockActual: true },
    });

    if (!insumo) throw new NotFoundException('Insumo no encontrado');

    // 2) Validar que no quede negativo
    const stockActual = Number(insumo.stockActual);
    if (stockActual - cant < 0) {
      throw new BadRequestException(
        `Stock insuficiente. Actual: ${stockActual}, querés descontar: ${cant}`,
      );
    }

    // 3) Descontar
    return this.prisma.insumo.update({
      where: { id },
      data: { stockActual: { decrement: cant } },
    });
  }
}
