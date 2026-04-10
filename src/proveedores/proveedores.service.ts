import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateProveedorDto } from './dto/create-proveedore.dto';
import { UpdateProveedorDto } from './dto/update-proveedore.dto';

@Injectable()
export class ProveedoresService {
  constructor(private prisma: PrismaService) {}

  async crear(dto: CreateProveedorDto) {
    return this.prisma.proveedor.create({
      data: {
        nombre: dto.nombre.trim(),
        telefono: dto.telefono?.trim(),
        email: dto.email?.trim(),
        notas: dto.notas?.trim(),
        activo: true,
      },
    });
  }

  async listar(incluirInactivos = false) {
    return this.prisma.proveedor.findMany({
      where: incluirInactivos ? {} : { activo: true },
      orderBy: { nombre: 'asc' },
    });
  }

  async findOne(id: string) {
    const prov = await this.prisma.proveedor.findUnique({
      where: { id },
      include: {
        insumos: { orderBy: { nombre: 'asc' } }, // útil para ver qué provee
      },
    });
    if (!prov) throw new NotFoundException('Proveedor no encontrado');
    return prov;
  }

  async update(id: string, dto: UpdateProveedorDto) {
    await this.ensureExists(id);

    return this.prisma.proveedor.update({
      where: { id },
      data: {
        ...dto,
        nombre: dto.nombre !== undefined ? dto.nombre.trim() : undefined,
        telefono: dto.telefono !== undefined ? dto.telefono.trim() : undefined,
        email: dto.email !== undefined ? dto.email.trim() : undefined,
        notas: dto.notas !== undefined ? dto.notas.trim() : undefined,
        activo: dto.activo !== undefined ? Boolean(dto.activo) : undefined,
      },
    });
  }

  async setActivo(id: string, activo: boolean) {
    await this.ensureExists(id);

    return this.prisma.proveedor.update({
      where: { id },
      data: { activo: Boolean(activo) },
    });
  }

  // ✅ delete real: no permitimos borrar si tiene insumos asignados
  async remove(id: string) {
    await this.ensureExists(id);

    const tieneInsumos = await this.prisma.insumo.count({
      where: { proveedorId: id },
    });

    if (tieneInsumos > 0) {
      throw new BadRequestException(
        'No se puede borrar un proveedor con insumos asignados. Usá baja lógica (activo=false) o desasigná los insumos.',
      );
    }

    return this.prisma.proveedor.delete({ where: { id } });
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.proveedor.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Proveedor no encontrado');
  }
}
