import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAderezoDto } from './dto/create-aderezo.dto';
import { SetPrecioCategoriaDto } from './dto/set-precio-categoria.dto';
import { SetConsumoCategoriaDto } from './dto/set-consumo-categoria.dto';
import { UpdateAderezoLegacyDto } from './dto/admin-aderezo.dto';

/**
 * Techo duro del historial. Mismos numeros que Insumos y Extras.
 *
 * El endpoint viejo hacia `parseInt(limit)` sin clamp: `?limit=999999` se traia
 * la tabla entera de movimientos, y `?limit=abc` daba NaN, que Prisma rechaza
 * con un 500.
 */
export const LIMITE_MOVIMIENTOS_MAXIMO = 200;
export const LIMITE_MOVIMIENTOS_POR_DEFECTO = 50;
export const LIMITE_RECIENTES_POR_DEFECTO = 20;

/** Deja el limite dentro de [1, LIMITE_MOVIMIENTOS_MAXIMO]. NaN cae al default. */
export function clampLimite(
  limit?: number,
  porDefecto = LIMITE_MOVIMIENTOS_POR_DEFECTO,
): number {
  if (limit === undefined || !Number.isFinite(limit)) return porDefecto;
  return Math.min(Math.max(Math.trunc(limit), 1), LIMITE_MOVIMIENTOS_MAXIMO);
}

const ADEREZO_INCLUDE = {
  precioPorCategoria: { include: { categoria: true } },
  categoriasAplica: { include: { categoria: true } },
  consumosPorCategoria: { include: { categoria: true } },
} as const;

@Injectable()
export class AderezosService {
  constructor(private prisma: PrismaService) {}

  async create(createAderezoDto: CreateAderezoDto) {
    const nombreLimpio = createAderezoDto.nombre.trim();

    const existente = await this.prisma.aderezo.findUnique({
      where: { nombre: nombreLimpio },
      select: { id: true, nombre: true },
    });

    if (existente) {
      throw new BadRequestException(
        `Ya existe un aderezo llamado "${nombreLimpio}". Usá un nombre diferente o editá el existente.`,
      );
    }

    const aderezo = await this.prisma.aderezo.create({
      data: {
        nombre: nombreLimpio,
        /**
         * 0, NO 999.
         *
         * El 999 era un default hardcodeado que nadie decidio: hacia que toda
         * salsa naciera "con stock de sobra" sin que se hubiera contado nada, y
         * por eso el panel viejo nunca podia avisar que faltaba. El otro extremo
         * del mismo bug estaba en el front (`AderezoModal`, que mandaba 999 fijo
         * al crear); el modal nuevo pide el stock real.
         *
         * Arrancar en 0 es el mismo criterio que Insumo y Extra: una salsa que
         * todavia no se cargo no tiene stock, y se ve como "sin stock" hasta
         * que alguien la reponga. Es la verdad, no un numero de relleno.
         */
        stockActual: createAderezoDto.stockActual ?? 0,
        /**
         * 'u' y no null: la unidad es obligatoria por contrato desde el rework
         * (ver `CrearAderezoDto`) y el backfill de 20260831000000 dejo la tabla
         * sin ningun null. Si este endpoint siguiera escribiendo null, volveria
         * a meter filas que la pantalla nueva no puede describir.
         */
        unidadMedida: createAderezoDto.unidadMedida ?? 'u',
        esGlobal: createAderezoDto.esGlobal ?? false,
        activo: true,
      },
      include: ADEREZO_INCLUDE,
    });

    if (
      createAderezoDto.categoriaIds &&
      createAderezoDto.categoriaIds.length > 0
    ) {
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

  async findByCategoriaProductoConStock(categoriaProductoId: string) {
    const aderezos = await this.prisma.aderezo.findMany({
      where: {
        activo: true,
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

    // Filtrar aderezos que tengan stock suficiente para la categoría del producto
    return aderezos.filter((aderezo) => {
      const consumo = aderezo.consumosPorCategoria?.find(
        (c) => c.categoriaId === categoriaProductoId,
      );
      const cantidadConsumo = consumo?.cantidadConsumo ?? 1;
      return aderezo.stockActual >= cantidadConsumo;
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
      console.warn(
        `[STOCK] Aderezo ${aderezo.nombre} no tiene unidadMedida definida. Se requiere para calcular consumo.`,
      );
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

  async getConsumoPorCategoria(
    aderezoId: string,
    categoriaId: string,
  ): Promise<number> {
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

  async update(id: string, dto: UpdateAderezoLegacyDto) {
    await this.findOne(id);

    if (dto.nombre !== undefined) {
      const nombreLimpio = dto.nombre.trim();
      const existente = await this.prisma.aderezo.findUnique({
        where: { nombre: nombreLimpio },
        select: { id: true, nombre: true },
      });
      if (existente && existente.id !== id) {
        throw new BadRequestException(
          `Ya existe otro aderezo llamado "${nombreLimpio}". Usá un nombre diferente.`,
        );
      }
    }

    const aderezoAntes = await this.prisma.aderezo.findUnique({
      where: { id },
      select: { stockActual: true },
    });
    const stockAntes = Number(aderezoAntes?.stockActual ?? 0);

    const aderezo = await this.prisma.aderezo.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined && { nombre: dto.nombre.trim() }),
        ...(dto.stockActual !== undefined && {
          stockActual: Number(dto.stockActual),
        }),
        ...(dto.activo !== undefined && { activo: dto.activo }),
        // Un string vacio ya NO vuelve la unidad a null: mandar "" era la otra
        // via por la que se colaban las filas sin unidad que el backfill de
        // 20260831000000 tuvo que arreglar. Vacio = "no lo toques".
        ...(dto.unidadMedida ? { unidadMedida: dto.unidadMedida } : {}),
        ...(dto.esGlobal !== undefined && { esGlobal: Boolean(dto.esGlobal) }),
      },
      include: ADEREZO_INCLUDE,
    });

    if (dto.stockActual !== undefined) {
      const stockDespues = Number(dto.stockActual);
      if (stockDespues !== stockAntes) {
        const diferencia = stockDespues - stockAntes;
        await this.prisma.stockMovimiento.create({
          data: {
            aderezoId: id,
            tipo: 'AJUSTE_MANUAL',
            cantidad: diferencia,
            stockAntes,
            stockDespues,
            motivo: `Stock ajustado de ${stockAntes} a ${stockDespues}`,
          },
        });
      }
    }

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

  async sumarStock(id: string, cantidad: number, motivo?: string) {
    await this.findOne(id);
    const cant = Number(cantidad);
    if (!Number.isFinite(cant) || cant <= 0)
      throw new BadRequestException('Cantidad inválida');

    const aderezo = await this.prisma.aderezo.findUnique({
      where: { id },
      select: { stockActual: true, nombre: true, unidadMedida: true },
    });
    const stockAntes = Number(aderezo?.stockActual ?? 0);

    const result = await this.prisma.aderezo.update({
      where: { id },
      data: { stockActual: { increment: cant } },
      include: ADEREZO_INCLUDE,
    });

    await this.prisma.stockMovimiento.create({
      data: {
        aderezoId: id,
        tipo: 'AJUSTE_MANUAL',
        cantidad: cant,
        stockAntes,
        stockDespues: stockAntes + cant,
        motivo: motivo?.trim() || `Stock manual +${cant}`,
      },
    });

    return result;
  }

  async descontarStock(id: string, cantidad: number, motivo?: string) {
    await this.findOne(id);
    const cant = Number(cantidad);
    if (!Number.isFinite(cant) || cant <= 0)
      throw new BadRequestException('Cantidad inválida');

    const aderezo = await this.prisma.aderezo.findUnique({
      where: { id },
      select: { stockActual: true, nombre: true, unidadMedida: true },
    });
    const stockAntes = Number(aderezo?.stockActual ?? 0);

    if (stockAntes < cant) {
      throw new BadRequestException('Stock insuficiente');
    }

    const result = await this.prisma.aderezo.update({
      where: { id },
      data: { stockActual: { decrement: cant } },
      include: ADEREZO_INCLUDE,
    });

    await this.prisma.stockMovimiento.create({
      data: {
        aderezoId: id,
        tipo: 'AJUSTE_MANUAL',
        cantidad: -cant,
        stockAntes,
        stockDespues: stockAntes - cant,
        motivo: motivo?.trim() || `Stock manual -${cant}`,
      },
    });

    return result;
  }

  async obtenerMovimientos(aderezoId: string, limit?: number) {
    return this.prisma.stockMovimiento.findMany({
      where: { aderezoId },
      orderBy: { createdAt: 'desc' },
      take: clampLimite(limit),
    });
  }

  async obtenerMovimientosRecientes(limit?: number) {
    return this.prisma.stockMovimiento.findMany({
      orderBy: { createdAt: 'desc' },
      take: clampLimite(limit, LIMITE_RECIENTES_POR_DEFECTO),
      where: { aderezoId: { not: null } },
      include: { aderezo: { select: { nombre: true } } },
    });
  }

  /**
   * Borrado, con el mismo guard que Productos y Extras: si la salsa ya se uso
   * en un pedido, no se borra.
   *
   * ⚠️ ACA EL GUARD NO ES UNA CORTESIA, EVITA UNA PERDIDA SILENCIOSA. `Aderezo`
   * tiene una relacion many-to-many REAL con `PedidoDetalle` (tabla implicita
   * `_AderezoToPedidoDetalle`) y sus dos foreign keys son ON DELETE CASCADE:
   * sin este chequeo el DELETE no falla, se lleva puestas las filas del join y
   * los pedidos historicos pierden para siempre que llevaban esta salsa. Encima
   * `StockMovimiento.aderezoId` es ON DELETE SET NULL, asi que sus movimientos
   * quedarian como filas huerfanas sin dueño.
   *
   * El chequeo esta duplicado en `AdminAderezosService.eliminar` a proposito:
   * los dos endpoints borran, asi que los dos tienen que proteger.
   */
  async remove(id: string) {
    await this.findOne(id);

    const usado = await this.prisma.pedidoDetalle.count({
      where: { aderezos: { some: { id } } },
      take: 1,
    });

    if (usado > 0) {
      throw new BadRequestException(
        'No se puede eliminar una salsa que ya se uso en pedidos: se perderia ' +
          'de que estaban hechos esos pedidos. Pausala (activo=false) para ' +
          'sacarla de la carta.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Los movimientos se borran junto con la salsa: el FK es SET NULL, asi
      // que sobrevivirian como filas sin dueño invisibles para todo historial.
      await tx.stockMovimiento.deleteMany({ where: { aderezoId: id } });
      // "AderezoPrecio" esta muerta (0 filas, marcada para deprecar); el
      // deleteMany queda por si quedara alguna fila de antes del rework.
      await tx.aderezoPrecio.deleteMany({ where: { aderezoId: id } });
      await tx.aderezoConsumo.deleteMany({ where: { aderezoId: id } });
      await tx.aderezoCategoria.deleteMany({ where: { aderezoId: id } });
      await tx.aderezo.delete({ where: { id } });
    });

    return { ok: true, id };
  }
}
