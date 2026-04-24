import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateExtraDto } from './dto/create-extra.dto';
import { UpdateExtraDto } from './dto/update-extra.dto';
import { SetExtraPrecioCategoriaDto } from './dto/set-precio-categoria.dto';
import { SetExtraConsumoCategoriaDto } from './dto/set-consumo-categoria.dto';

const EXTRA_INCLUDE = {
  insumo: true,
  preciosPorCategoria: { include: { categoria: true } },
  categoriasAplica: { include: { categoria: true } },
  consumosPorCategoria: { include: { categoria: true } },
} as const;

@Injectable()
export class ExtrasService {
  constructor(private prisma: PrismaService) {}

  private normNombre(nombre: string) {
    return (nombre || '').trim();
  }
  private normCategoria(cat?: string) {
    const v = (cat || 'ADEREZOS').trim();
    return v.length ? v.toUpperCase() : 'ADEREZOS';
  }

  async create(dto: CreateExtraDto) {
    const nombre = this.normNombre(dto.nombre);
    if (!nombre) throw new BadRequestException('nombre es obligatorio');

    if (dto.insumoId) {
      const insumo = await this.prisma.insumo.findUnique({
        where: { id: dto.insumoId },
        select: { id: true },
      });
      if (!insumo) {
        throw new BadRequestException(
          `Insumo con ID ${dto.insumoId} no encontrado`,
        );
      }
    }

    const extra = await this.prisma.extra.create({
      data: {
        nombre,
        precio: dto.precio !== undefined ? Number(dto.precio) : 500,
        stockActual:
          dto.stockActual !== undefined ? Number(dto.stockActual) : 0,
        activo: dto.activo !== undefined ? Boolean(dto.activo) : true,
        esGlobal: dto.esGlobal ?? false,
        categoria: this.normCategoria(dto.categoria),
        unidadMedida: dto.unidadMedida || 'un',
        insumoId: dto.insumoId || null,
      },
      include: EXTRA_INCLUDE,
    });

    if (dto.categoriaIds && dto.categoriaIds.length > 0) {
      await this.prisma.extraCategoria.createMany({
        data: dto.categoriaIds.map((catId) => ({
          extraId: extra.id,
          categoriaId: catId,
        })),
      });
    }

    return this.findOne(extra.id);
  }

  async findAll(opts?: {
    incluirInactivos?: boolean;
    soloDisponibles?: boolean;
    categoria?: string;
    categoriaId?: string;
  }) {
    const incluirInactivos = Boolean(opts?.incluirInactivos);
    const soloDisponibles = Boolean(opts?.soloDisponibles);
    const categoria = opts?.categoria
      ? this.normCategoria(opts.categoria)
      : null;

    return this.prisma.extra.findMany({
      where: {
        ...(incluirInactivos ? {} : { activo: true }),
        ...(soloDisponibles ? { stockActual: { gt: 0 } } : {}),
        ...(categoria ? { categoria } : {}),
      },
      include: EXTRA_INCLUDE,
      orderBy: [{ categoria: 'asc' }, { nombre: 'asc' }],
    });
  }

  async findByCategoriaProducto(categoriaProductoId: string) {
    return this.prisma.extra.findMany({
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
      include: EXTRA_INCLUDE,
      orderBy: { nombre: 'asc' },
    });
  }

  async findOne(id: string) {
    const e = await this.prisma.extra.findUnique({
      where: { id },
      include: EXTRA_INCLUDE,
    });
    if (!e) throw new NotFoundException('Extra no encontrado');
    return e;
  }

  async getPrecioPorCategoria(extraId: string, categoriaId: string) {
    const precioEspecifico = await this.prisma.extraPrecio.findUnique({
      where: {
        extraId_categoriaId: { extraId, categoriaId },
      },
    });

    if (precioEspecifico) {
      return Number(precioEspecifico.precio);
    }

    const extra = await this.prisma.extra.findUnique({
      where: { id: extraId },
      select: { precio: true },
    });

    return extra ? Number(extra.precio) : 0;
  }

  async setPrecioCategoria(dto: SetExtraPrecioCategoriaDto) {
    const extra = await this.prisma.extra.findUnique({
      where: { id: dto.extraId },
    });

    if (!extra) throw new NotFoundException('Extra no encontrado');

    const categoria = await this.prisma.categoria.findUnique({
      where: { id: dto.categoriaId },
    });

    if (!categoria) throw new NotFoundException('Categoría no encontrada');

    return this.prisma.extraPrecio.upsert({
      where: {
        extraId_categoriaId: {
          extraId: dto.extraId,
          categoriaId: dto.categoriaId,
        },
      },
      update: { precio: dto.precio },
      create: {
        extraId: dto.extraId,
        categoriaId: dto.categoriaId,
        precio: dto.precio,
      },
      include: { extra: true, categoria: true },
    });
  }

  async setConsumoCategoria(dto: SetExtraConsumoCategoriaDto) {
    const extra = await this.prisma.extra.findUnique({
      where: { id: dto.extraId },
    });

    if (!extra) throw new NotFoundException('Extra no encontrado');

    const categoria = await this.prisma.categoria.findUnique({
      where: { id: dto.categoriaId },
    });

    if (!categoria) throw new NotFoundException('Categoría no encontrada');

    return this.prisma.extraConsumo.upsert({
      where: {
        extraId_categoriaId: {
          extraId: dto.extraId,
          categoriaId: dto.categoriaId,
        },
      },
      update: { cantidadConsumo: dto.cantidadConsumo },
      create: {
        extraId: dto.extraId,
        categoriaId: dto.categoriaId,
        cantidadConsumo: dto.cantidadConsumo,
      },
      include: { extra: true, categoria: true },
    });
  }

  async getConsumoPorCategoria(extraId: string, categoriaId: string): Promise<number> {
    const consumo = await this.prisma.extraConsumo.findUnique({
      where: {
        extraId_categoriaId: {
          extraId,
          categoriaId,
        },
      },
    });

    return consumo?.cantidadConsumo ?? 0;
  }

  async update(id: string, dto: UpdateExtraDto) {
    await this.ensureExists(id);

    if (dto.insumoId !== undefined && dto.insumoId !== null) {
      const insumo = await this.prisma.insumo.findUnique({
        where: { id: dto.insumoId },
        select: { id: true },
      });
      if (!insumo) {
        throw new BadRequestException(
          `Insumo con ID ${dto.insumoId} no encontrado`,
        );
      }
    }

    const { categoriaIds, ...rest } = dto;

    const data: any = {
      ...rest,
      nombre:
        rest.nombre !== undefined ? this.normNombre(rest.nombre) : undefined,
      precio: rest.precio !== undefined ? Number(rest.precio) : undefined,
      stockActual:
        rest.stockActual !== undefined ? Number(rest.stockActual) : undefined,
      categoria:
        rest.categoria !== undefined
          ? this.normCategoria(rest.categoria)
          : undefined,
      unidadMedida: rest.unidadMedida,
      esGlobal: rest.esGlobal !== undefined ? Boolean(rest.esGlobal) : undefined,
      insumoId: rest.insumoId !== undefined ? rest.insumoId : undefined,
    };

    const extra = await this.prisma.extra.update({
      where: { id },
      data,
      include: EXTRA_INCLUDE,
    });

    if (categoriaIds !== undefined) {
      await this.prisma.extraCategoria.deleteMany({
        where: { extraId: id },
      });

      if (categoriaIds.length > 0) {
        await this.prisma.extraCategoria.createMany({
          data: categoriaIds.map((catId) => ({
            extraId: id,
            categoriaId: catId,
          })),
        });
      }

      return this.findOne(id);
    }

    return extra;
  }

  async setActivo(id: string, activo: boolean) {
    await this.ensureExists(id);
    return this.prisma.extra.update({
      where: { id },
      data: { activo: Boolean(activo) },
      include: EXTRA_INCLUDE,
    });
  }

  async sumarStock(id: string, cantidad: number) {
    await this.ensureExists(id);
    const cant = Number(cantidad);
    if (!Number.isFinite(cant) || cant <= 0)
      throw new BadRequestException('Cantidad inválida');

    const extra = await this.prisma.extra.findUnique({
      where: { id },
      select: { insumoId: true },
    });

    if (extra?.insumoId) {
      await this.prisma.insumo.update({
        where: { id: extra.insumoId },
        data: { stockActual: { increment: cant } },
      });
      return this.prisma.extra.findUnique({
        where: { id },
        include: EXTRA_INCLUDE,
      });
    }

    return this.prisma.extra.update({
      where: { id },
      data: { stockActual: { increment: cant } },
      include: EXTRA_INCLUDE,
    });
  }

  async descontarStock(id: string, cantidad: number) {
    await this.ensureExists(id);
    const cant = Number(cantidad);
    if (!Number.isFinite(cant) || cant <= 0)
      throw new BadRequestException('Cantidad inválida');

    const extra = await this.prisma.extra.findUnique({
      where: { id },
      select: { insumoId: true, stockActual: true },
    });

    if (extra?.insumoId) {
      const updated = await this.prisma.insumo.updateMany({
        where: { id: extra.insumoId, stockActual: { gte: cant } },
        data: { stockActual: { decrement: cant } },
      });

      if (updated.count === 0) {
        throw new BadRequestException(
          'Stock insuficiente en el insumo asociado',
        );
      }

      return this.prisma.extra.findUnique({
        where: { id },
        include: EXTRA_INCLUDE,
      });
    }

    const updated = await this.prisma.extra.updateMany({
      where: { id, stockActual: { gte: cant } },
      data: { stockActual: { decrement: cant } },
    });

    if (updated.count === 0) {
      throw new BadRequestException('Stock insuficiente');
    }

    return this.prisma.extra.findUnique({
      where: { id },
      include: EXTRA_INCLUDE,
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.extraPrecio.deleteMany({ where: { extraId: id } });
    await this.prisma.extraConsumo.deleteMany({ where: { extraId: id } });
    return this.prisma.extra.delete({ where: { id } });
  }

  private async ensureExists(id: string) {
    const e = await this.prisma.extra.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!e) throw new NotFoundException('Extra no encontrado');
  }
}
