import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateCategoriaDto } from './dto/create-categoria.dto';
import { UpdateCategoriaDto } from './dto/update-categoria.dto';

@Injectable()
export class CategoriasService {
  constructor(private prisma: PrismaService) {}

  async crear(dto: CreateCategoriaDto) {
    return this.prisma.categoria.create({
      data: {
        nombre: dto.nombre.trim(),
        descripcion: dto.descripcion?.trim() ?? null,
        activo: dto.activo ?? true,
      },
    });
  }

  async listar(incluirInactivas = false) {
    return this.prisma.categoria.findMany({
      where: incluirInactivas ? {} : { activo: true },
      orderBy: { nombre: 'asc' },
    });
  }

  async obtener(id: string) {
    const cat = await this.prisma.categoria.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException('Categoría no encontrada');
    return cat;
  }

  async actualizar(id: string, dto: UpdateCategoriaDto) {
    await this.ensureExists(id);
    return this.prisma.categoria.update({
      where: { id },
      data: {
        ...dto,
        nombre: dto.nombre !== undefined ? dto.nombre.trim() : undefined,
        descripcion:
          dto.descripcion !== undefined
            ? (dto.descripcion?.trim() ?? null)
            : undefined,
      },
    });
  }

  async setActivo(id: string, activo: boolean) {
    await this.ensureExists(id);
    return this.prisma.categoria.update({
      where: { id },
      data: { activo: Boolean(activo) },
    });
  }

  async borrar(id: string) {
    await this.ensureExists(id);

    const usados = await this.prisma.producto.count({
      where: { categoriaId: id },
    });

    if (usados > 0) {
      throw new BadRequestException(
        'No se puede borrar una categoría que tiene productos. Desactivala (activo=false).',
      );
    }

    return this.prisma.categoria.delete({ where: { id } });
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.categoria.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Categoría no encontrada');
  }
}
