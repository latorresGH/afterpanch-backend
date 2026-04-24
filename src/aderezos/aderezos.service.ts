import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAderezoDto } from './dto/create-aderezo.dto';
import { SetPrecioCategoriaDto } from './dto/set-precio-categoria.dto';
import { SetConsumoCategoriaDto } from './dto/set-consumo-categoria.dto';

const ADEREZO_INCLUDE = {
  precioPorCategoria: { include: { categoria: true } },
  categoriasAplica: { include: { categoria: true } },
  consumosPorCategoria: { include: { categoria: true } },
} as const;

@Injectable()
export class AderezosService {
  constructor(private prisma: PrismaService) {}

  async create(createAderezoDto: CreateAderezoDto) {
    const aderezo = await this.prisma.aderezo.create({
      data: {
        nombre: createAderezoDto.nombre.trim(),
        stockActual: createAderezoDto.stockActual ?? 999,
        unidadMedida: createAderezoDto.unidadMedida ?? null,
        esGlobal: createAderezoDto.esGlobal ?? false,
        activo: true,
      },
      include: ADEREZO_INCLUDE,
    });

    if (createAderezoDto.categoriaIds && createAderezoDto.categoriaIds.length > 0) {
      await this.prisma.aderezoCategoria.createMany({
        data: createAderezoDto.categoriaIds.map((catId) => ({
          aderezoId: aderezo.id,
          categoriaId: catId,
        })),
      });
    }

    return this.findOne(aderezo.id);
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
      include: ADEREZO_INCLUDE,
      orderBy: { nombre: 'asc' },
    });
  }

  async findByCategoriaProducto(categoriaProductoId: string) {
    return this.prisma.aderezo.findMany({
      where: {
        activo: true,
        stockActual: { gt: 0 },
        OR: [
          { esGlobal: true },
          {
            categoriasAplica: {
              some: { categoriaId: categoriaProductoId },
            },
          },
        ],
      },
      include: ADEREZO_INCLUDE,
      orderBy: { nombre: 'asc' },
    });
  }

  async findOne(id: string) {
    const aderezo = await this.prisma.aderezo.findUnique({
      where: { id },
      include: ADEREZO_INCLUDE,
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

  async setConsumoCategoria(dto: SetConsumoCategoriaDto) {
    const aderezo = await this.prisma.aderezo.findUnique({
      where: { id: dto.aderezoId },
    });

    if (!aderezo) throw new NotFoundException('Aderezo no encontrado');

    const categoria = await this.prisma.categoria.findUnique({
      where: { id: dto.categoriaId },
    });

    if (!categoria) throw new NotFoundException('Categoría no encontrada');

    if (!aderezo.unidadMedida) {
      console.warn(`[STOCK] Aderezo ${aderezo.nombre} no tiene unidadMedida definida. Se requiere para calcular consumo.`);
    }

    return this.prisma.aderezoConsumo.upsert({
      where: {
        aderezoId_categoriaId: {
          aderezoId: dto.aderezoId,
          categoriaId: dto.categoriaId,
        },
      },
      update: { cantidadConsumo: dto.cantidadConsumo },
      create: {
        aderezoId: dto.aderezoId,
        categoriaId: dto.categoriaId,
        cantidadConsumo: dto.cantidadConsumo,
      },
      include: { aderezo: true, categoria: true },
    });
  }

  async getConsumoPorCategoria(aderezoId: string, categoriaId: string): Promise<number> {
    const consumo = await this.prisma.aderezoConsumo.findUnique({
      where: {
        aderezoId_categoriaId: {
          aderezoId,
          categoriaId,
        },
      },
    });

    return consumo?.cantidadConsumo ?? 0;
  }

  async update(
    id: string,
    dto: { nombre?: string; stockActual?: number; activo?: boolean; unidadMedida?: string; esGlobal?: boolean; categoriaIds?: string[] },
  ) {
    await this.findOne(id);

    const aderezo = await this.prisma.aderezo.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined && { nombre: dto.nombre.trim() }),
        ...(dto.stockActual !== undefined && {
          stockActual: Number(dto.stockActual),
        }),
        ...(dto.activo !== undefined && { activo: dto.activo }),
        ...(dto.unidadMedida !== undefined && { unidadMedida: dto.unidadMedida || null }),
        ...(dto.esGlobal !== undefined && { esGlobal: Boolean(dto.esGlobal) }),
      },
      include: ADEREZO_INCLUDE,
    });

    if (dto.categoriaIds !== undefined) {
      await this.prisma.aderezoCategoria.deleteMany({
        where: { aderezoId: id },
      });

      if (dto.categoriaIds.length > 0) {
        await this.prisma.aderezoCategoria.createMany({
          data: dto.categoriaIds.map((catId) => ({
            aderezoId: id,
            categoriaId: catId,
          })),
        });
      }

      return this.findOne(id);
    }

    return aderezo;
  }

  async setActivo(id: string, activo: boolean) {
    await this.findOne(id);
    return this.prisma.aderezo.update({
      where: { id },
      data: { activo: Boolean(activo) },
      include: ADEREZO_INCLUDE,
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
      include: ADEREZO_INCLUDE,
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
      include: ADEREZO_INCLUDE,
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    await this.prisma.aderezoPrecio.deleteMany({
      where: { aderezoId: id },
    });

    await this.prisma.aderezoConsumo.deleteMany({
      where: { aderezoId: id },
    });

    return this.prisma.aderezo.delete({ where: { id } });
  }
}
