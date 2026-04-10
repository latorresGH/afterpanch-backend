import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAderezoDto } from './dto/create-aderezo.dto';
import { SetPrecioCategoriaDto } from './dto/set-precio-categoria.dto';

@Injectable()
export class AderezosService {
  constructor(private prisma: PrismaService) {}

  async create(createAderezoDto: CreateAderezoDto) {
    return this.prisma.aderezo.create({
      data: {
        nombre: createAderezoDto.nombre.trim(),
        stockActual: createAderezoDto.stockActual ?? 999,
        activo: true,
      },
      include: { precioPorCategoria: { include: { categoria: true } } },
    });
  }

  async findAll(opts?: {
    incluirInactivos?: boolean;
    soloDisponibles?: boolean;
  }) {
    const incluirInactivos = Boolean(opts?.incluirInactivos);
    const soloDisponibles = Boolean(opts?.soloDisponibles);

    return this.prisma.aderezo.findMany({
      where: {
        ...(incluirInactivos ? {} : { activo: true }),
        ...(soloDisponibles ? { stockActual: { gt: 0 } } : {}),
      },
      include: {
        precioPorCategoria: {
          include: { categoria: true },
        },
      },
      orderBy: { nombre: 'asc' },
    });
  }

  async findOne(id: string) {
    const aderezo = await this.prisma.aderezo.findUnique({
      where: { id },
      include: {
        precioPorCategoria: {
          include: { categoria: true },
        },
      },
    });

    if (!aderezo) throw new NotFoundException('Aderezo no encontrado');
    return aderezo;
  }

  async setPrecioCategoria(dto: SetPrecioCategoriaDto) {
    const aderezo = await this.prisma.aderezo.findUnique({
      where: { id: dto.aderezoId },
    });

    if (!aderezo) throw new NotFoundException('Aderezo no encontrado');

    const categoria = await this.prisma.categoria.findUnique({
      where: { id: dto.categoriaId },
    });

    if (!categoria) throw new NotFoundException('Categoría no encontrada');

    return this.prisma.aderezoPrecio.upsert({
      where: {
        aderezoId_categoriaId: {
          aderezoId: dto.aderezoId,
          categoriaId: dto.categoriaId,
        },
      },
      update: { precio: dto.precio },
      create: {
        aderezoId: dto.aderezoId,
        categoriaId: dto.categoriaId,
        precio: dto.precio,
      },
      include: { aderezo: true, categoria: true },
    });
  }

  async getPrecioPorCategoria(aderezoId: string, categoriaId: string) {
    const precio = await this.prisma.aderezoPrecio.findUnique({
      where: {
        aderezoId_categoriaId: {
          aderezoId,
          categoriaId,
        },
      },
    });

    return precio?.precio ?? 0;
  }

  async update(
    id: string,
    dto: { nombre?: string; stockActual?: number; activo?: boolean },
  ) {
    await this.findOne(id);

    return this.prisma.aderezo.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined && { nombre: dto.nombre.trim() }),
        ...(dto.stockActual !== undefined && {
          stockActual: Number(dto.stockActual),
        }),
        ...(dto.activo !== undefined && { activo: dto.activo }),
      },
      include: { precioPorCategoria: { include: { categoria: true } } },
    });
  }

  async setActivo(id: string, activo: boolean) {
    await this.findOne(id);
    return this.prisma.aderezo.update({
      where: { id },
      data: { activo: Boolean(activo) },
      include: { precioPorCategoria: { include: { categoria: true } } },
    });
  }

  async sumarStock(id: string, cantidad: number) {
    await this.findOne(id);
    const cant = Number(cantidad);
    if (!Number.isFinite(cant) || cant <= 0)
      throw new BadRequestException('Cantidad inválida');

    return this.prisma.aderezo.update({
      where: { id },
      data: { stockActual: { increment: cant } },
      include: { precioPorCategoria: { include: { categoria: true } } },
    });
  }

  async descontarStock(id: string, cantidad: number) {
    await this.findOne(id);
    const cant = Number(cantidad);
    if (!Number.isFinite(cant) || cant <= 0)
      throw new BadRequestException('Cantidad inválida');

    const updated = await this.prisma.aderezo.updateMany({
      where: { id, stockActual: { gte: cant } },
      data: { stockActual: { decrement: cant } },
    });

    if (updated.count === 0) {
      throw new BadRequestException('Stock insuficiente');
    }

    return this.prisma.aderezo.findUnique({
      where: { id },
      include: { precioPorCategoria: { include: { categoria: true } } },
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    await this.prisma.aderezoPrecio.deleteMany({
      where: { aderezoId: id },
    });

    return this.prisma.aderezo.delete({ where: { id } });
  }
}
