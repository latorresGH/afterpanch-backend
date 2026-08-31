import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AdminInsumosService } from './admin-insumos.service';
import { CreateInsumoDto } from './dto/create-insumo.dto';
import {
  LIMITE_MOVIMIENTOS_MAXIMO,
  LIMITE_MOVIMIENTOS_POR_DEFECTO,
} from './dto/movimientos-query.dto';
import { UpdateInsumoDto } from './dto/update-insumo.dto';

/** Techo de `GET /insumos/movimientos/recientes`. */
const LIMITE_RECIENTES_MAXIMO = 100;
const LIMITE_RECIENTES_POR_DEFECTO = 20;

@Injectable()
export class InsumosService {
  constructor(
    private prisma: PrismaService,
    private readonly adminInsumos: AdminInsumosService,
  ) {}

  /**
   * Alta de insumo.
   *
   * `stockMinimo` es obligatorio (lo impone el DTO): desde que se elimino el
   * umbral global, un insumo sin minimo propio no tiene contra que comparar y
   * quedaria fuera de todas las alertas sin que nadie lo note.
   *
   * Si nace con stock, se le abre el ledger con un AJUSTE_MANUAL. Antes no se
   * escribia nada, asi que el historial de un insumo cargado con 30 kg
   * arrancaba en blanco y el primer descuento aparecia saliendo de la nada.
   */
  async crear(dto: CreateInsumoDto) {
    const nombre = dto.nombre.trim();
    const unidadMedida = dto.unidadMedida.trim();

    // `stockInicial` es el alias historico que manda el form que hay hoy en
    // produccion. Ver la nota del DTO.
    const stockActual = dto.stockActual ?? dto.stockInicial ?? 0;

    await this.ensureProveedorExists(dto.proveedorId);

    return this.prisma.$transaction(async (tx) => {
      const insumo = await tx.insumo.create({
        data: {
          nombre,
          unidadMedida,
          stockActual,
          stockMinimo: dto.stockMinimo,
          activo: dto.activo ?? true,
          proveedorId: dto.proveedorId ?? null,
        },
        include: { proveedor: true },
      });

      if (stockActual > 0) {
        await tx.stockMovimiento.create({
          data: {
            insumoId: insumo.id,
            tipo: 'AJUSTE_MANUAL',
            cantidad: stockActual,
            stockAntes: 0,
            stockDespues: stockActual,
            motivo: 'Stock inicial del alta',
          },
        });
      }

      return insumo;
    });
  }

  async obtenerTodo(incluirInactivos = false) {
    return this.prisma.insumo.findMany({
      where: incluirInactivos ? {} : { activo: true },
      include: { proveedor: true },
      orderBy: { nombre: 'asc' },
    });
  }

  /**
   * Cuántos insumos activos están por debajo de su `stockMinimo`.
   *
   * Lo cuenta Postgres comparando las dos columnas (field reference de
   * Prisma), no el proceso de Node: el Home solo necesita el número, traer
   * la tabla entera para filtrarla a mano sería traer datos para tirarlos.
   *
   * Esta comparación es la definición de "stock bajo" del Home y siempre fue
   * contra el mínimo del propio insumo, nunca contra el umbral global que se
   * eliminó en esta sección: el aviso de la esquina del Home no cambia de
   * comportamiento por ese cambio.
   */
  async contarBajoMinimo(): Promise<number> {
    return this.prisma.insumo.count({
      where: {
        activo: true,
        stockActual: { lt: this.prisma.insumo.fields.stockMinimo },
      },
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

  /**
   * Edición de insumo.
   *
   * Si el PATCH trae `stockActual`, se deja rastro en el ledger. Antes no lo
   * dejaba: el stock cambiaba de 12 a 3 y el historial no tenía la línea, así
   * que el modal mostraba un salto sin explicación entre dos movimientos. Es
   * un AJUSTE_MANUAL como el de `/sumar` y `/restar`, con la diferencia de que
   * acá el valor es absoluto y la cantidad del movimiento es la delta.
   */
  async actualizar(id: string, dto: UpdateInsumoDto, userId?: string) {
    const actual = await this.prisma.insumo.findUnique({
      where: { id },
      select: { id: true, stockActual: true },
    });
    if (!actual) throw new NotFoundException('Insumo no encontrado');

    const { proveedorId, stockActual, ...rest } = dto;

    if (proveedorId) await this.ensureProveedorExists(proveedorId);

    const stockAntes = Number(actual.stockActual);
    const stockDespues = stockActual !== undefined ? stockActual : stockAntes;
    const delta = stockDespues - stockAntes;

    return this.prisma.$transaction(async (tx) => {
      const insumo = await tx.insumo.update({
        where: { id },
        data: {
          ...rest,
          nombre: rest.nombre !== undefined ? rest.nombre.trim() : undefined,
          unidadMedida:
            rest.unidadMedida !== undefined
              ? rest.unidadMedida.trim()
              : undefined,
          stockActual,

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

      // Solo si el stock se movió de verdad: reenviar el mismo valor desde el
      // form no es un ajuste y no tiene por qué ensuciar el historial.
      if (delta !== 0) {
        await tx.stockMovimiento.create({
          data: {
            insumoId: id,
            tipo: 'AJUSTE_MANUAL',
            cantidad: delta,
            stockAntes,
            stockDespues,
            motivo: 'Corrección de stock desde la edición del insumo',
            userId,
          },
        });
      }

      return insumo;
    });
  }

  async sumarStock(
    id: string,
    cantidad: number,
    motivo?: string,
    userId?: string,
  ) {
    const cant = Number(cantidad);
    if (!Number.isFinite(cant) || cant <= 0) {
      throw new BadRequestException('Cantidad inválida');
    }

    const insumo = await this.prisma.insumo.findUnique({
      where: { id },
      select: { id: true, stockActual: true },
    });

    if (!insumo) throw new NotFoundException('Insumo no encontrado');

    const stockAntes = Number(insumo.stockActual);
    const stockDespues = stockAntes + cant;

    const result = await this.prisma.insumo.update({
      where: { id },
      data: { stockActual: { increment: cant } },
      include: { proveedor: true },
    });

    await this.registrarMovimiento({
      insumoId: id,
      tipo: 'AJUSTE_MANUAL',
      cantidad: cant,
      stockAntes,
      stockDespues,
      motivo: motivo || 'Ajuste manual de stock',
      userId,
    });

    return result;
  }

  async setActivo(id: string, activo: boolean) {
    await this.ensureExists(id);

    return this.prisma.insumo.update({
      where: { id },
      data: { activo: Boolean(activo) },
      include: { proveedor: true },
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

  /**
   * El `proveedorId` se valida acá y no se deja explotar en la FK: Prisma
   * devuelve un P2025 opaco ("An operation failed because it depends on one or
   * more records that were required but not found") que el filtro global
   * traduce a un 500. Un id inexistente es un error del que llama, no del
   * server.
   */
  private async ensureProveedorExists(proveedorId?: string | null) {
    if (!proveedorId) return;

    const existe = await this.prisma.proveedor.findUnique({
      where: { id: proveedorId },
      select: { id: true },
    });
    if (!existe) throw new BadRequestException('Proveedor no encontrado');
  }

  async descontarStock(
    id: string,
    cantidad: number,
    pedidoId?: string,
    motivo?: string,
    userId?: string,
  ) {
    const cant = Number(cantidad);
    if (!Number.isFinite(cant) || cant <= 0) {
      throw new BadRequestException('Cantidad inválida');
    }

    const insumo = await this.prisma.insumo.findUnique({
      where: { id },
      select: { id: true, stockActual: true },
    });

    if (!insumo) throw new NotFoundException('Insumo no encontrado');

    const stockActual = Number(insumo.stockActual);
    if (stockActual - cant < 0) {
      throw new BadRequestException(
        `Stock insuficiente. Actual: ${stockActual}, querés descontar: ${cant}`,
      );
    }

    const result = await this.prisma.insumo.update({
      where: { id },
      data: { stockActual: { decrement: cant } },
    });

    await this.registrarMovimiento({
      insumoId: id,
      tipo: pedidoId ? 'DESCUENTO_PEDIDO' : 'AJUSTE_MANUAL',
      cantidad: -cant,
      stockAntes: stockActual,
      stockDespues: stockActual - cant,
      pedidoId,
      motivo:
        motivo || (pedidoId ? 'Consumo por pedido' : 'Ajuste manual de stock'),
      userId,
    });

    return result;
  }

  async registrarMovimiento(data: {
    insumoId: string;
    tipo: string;
    cantidad: number;
    stockAntes: number;
    stockDespues: number;
    pedidoId?: string;
    motivo?: string;
    userId?: string;
  }) {
    return this.prisma.stockMovimiento.create({ data });
  }

  /**
   * Historial crudo de un insumo.
   *
   * `limit` viene clampeado: sin techo, un `?limit=999999` se traía la tabla
   * entera de movimientos en una request sin paginar.
   *
   * La versión rica de esto (con la ficha del insumo y el pedido resuelto) es
   * `GET /admin/insumos/:id/movimientos`. Este se mantiene porque el POS ya lo
   * consume tal cual.
   */
  async obtenerMovimientos(insumoId: string, limitPedido?: number) {
    const take = this.clamp(
      limitPedido,
      LIMITE_MOVIMIENTOS_POR_DEFECTO,
      LIMITE_MOVIMIENTOS_MAXIMO,
    );

    return this.prisma.stockMovimiento.findMany({
      where: { insumoId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async obtenerMovimientosRecientes(limitPedido?: number) {
    const take = this.clamp(
      limitPedido,
      LIMITE_RECIENTES_POR_DEFECTO,
      LIMITE_RECIENTES_MAXIMO,
    );

    return this.prisma.stockMovimiento.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      include: { insumo: { select: { nombre: true } } },
    });
  }

  /**
   * Reporte de consumo, en la forma vieja.
   *
   * @deprecated usar `GET /admin/insumos/reporte-consumo`, que devuelve además
   * la serie diaria, el porcentaje sobre el total y el corte entre descontado
   * y repuesto.
   *
   * Se mantiene porque el panel que hay hoy en producción lo consume con esta
   * forma exacta, pero por dentro ya NO agrega en memoria: delega en el
   * agregado de Postgres y recorta. Eso arregla de paso el bug de zona horaria
   * que tenía: `new Date('2026-08-10')` se interpreta como UTC, así que en un
   * server en UTC-3 el rango arrancaba el 9 a las 21:00.
   */
  async reporteConsumo(desde: string, hasta: string) {
    const reporte = await this.adminInsumos.reporteConsumo({
      desde,
      hasta,
      limite: 100,
    });

    return reporte.items.map((item) => ({
      insumoId: item.insumoId,
      nombre: item.nombre,
      unidadMedida: item.unidadMedida,
      totalConsumido: item.consumido,
      cantidadMovimientos: item.movimientos,
    }));
  }

  /** Entero dentro de [1, maximo], con default si no vino nada usable. */
  private clamp(valor: number | undefined, porDefecto: number, maximo: number) {
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 1) return porDefecto;
    return Math.min(Math.floor(n), maximo);
  }
}

/** Re-export para que los consumidores no tengan que importar de Prisma. */
export type InsumoConProveedor = Prisma.InsumoGetPayload<{
  include: { proveedor: true };
}>;
