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
    const nombreLimpio = (nombre || '').trim();
    const unidadLimpia = (unidad || 'unidades').trim();
    const stock = Number(stockInicial) || 0;

    return this.prisma.insumo.create({
      data: {
        nombre: nombreLimpio,
        stockActual: stock,
        unidadMedida: unidadLimpia,
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

  async sumarStock(id: string, cantidad: number, motivo?: string, userId?: string) {
    await this.ensureExists(id);

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

  async descontarStock(id: string, cantidad: number, pedidoId?: string, motivo?: string, userId?: string) {
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
      motivo: motivo || (pedidoId ? 'Consumo por pedido' : 'Ajuste manual de stock'),
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

  async obtenerMovimientos(insumoId: string, limit = 50) {
    return this.prisma.stockMovimiento.findMany({
      where: { insumoId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async obtenerMovimientosRecientes(limit = 20) {
    return this.prisma.stockMovimiento.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { insumo: { select: { nombre: true } } },
    });
  }

  async reporteConsumo(desde: string, hasta: string) {
    const start = new Date(desde);
    const end = new Date(hasta);
    end.setHours(23, 59, 59, 999);

    const movimientos = await this.prisma.stockMovimiento.findMany({
      where: {
        tipo: 'DESCUENTO_PEDIDO',
        createdAt: { gte: start, lte: end },
      },
      include: { insumo: { select: { nombre: true, unidadMedida: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const agrupado = new Map<string, { insumoId: string; nombre: string; unidadMedida: string; totalConsumido: number; cantidadMovimientos: number }>();

    for (const m of movimientos) {
      const key = m.insumoId;
      const existente = agrupado.get(key);
      if (existente) {
        existente.totalConsumido += Math.abs(m.cantidad);
        existente.cantidadMovimientos += 1;
      } else {
        agrupado.set(key, {
          insumoId: m.insumoId,
          nombre: m.insumo.nombre,
          unidadMedida: m.insumo.unidadMedida,
          totalConsumido: Math.abs(m.cantidad),
          cantidadMovimientos: 1,
        });
      }
    }

    return Array.from(agrupado.values()).sort((a, b) => b.totalConsumido - a.totalConsumido);
  }
}
