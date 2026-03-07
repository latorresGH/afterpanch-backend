import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { CreateExtraDto } from "./dto/create-extra.dto";
import { UpdateExtraDto } from "./dto/update-extra.dto";

@Injectable()
export class ExtrasService {
  constructor(private prisma: PrismaService) {}

  private normNombre(nombre: string) {
    return (nombre || "").trim();
  }
  private normCategoria(cat?: string) {
    const v = (cat || "ADEREZOS").trim();
    return v.length ? v.toUpperCase() : "ADEREZOS";
  }

  async create(dto: CreateExtraDto) {
    const nombre = this.normNombre(dto.nombre);
    if (!nombre) throw new BadRequestException("nombre es obligatorio");

    return this.prisma.extra.create({
      data: {
        nombre,
        precio: dto.precio !== undefined ? Number(dto.precio) : 500,
        stockActual: dto.stockActual !== undefined ? Number(dto.stockActual) : 0,
        activo: dto.activo !== undefined ? Boolean(dto.activo) : true,
        categoria: this.normCategoria(dto.categoria),
      },
    });
  }

  // /extras?incluirInactivos=true&soloDisponibles=true&categoria=ADEREZOS
  async findAll(opts?: { incluirInactivos?: boolean; soloDisponibles?: boolean; categoria?: string }) {
    const incluirInactivos = Boolean(opts?.incluirInactivos);
    const soloDisponibles = Boolean(opts?.soloDisponibles);
    const categoria = opts?.categoria ? this.normCategoria(opts.categoria) : null;

    return this.prisma.extra.findMany({
      where: {
        ...(incluirInactivos ? {} : { activo: true }),
        ...(soloDisponibles ? { stockActual: { gt: 0 } } : {}),
        ...(categoria ? { categoria } : {}),
      },
      orderBy: [{ categoria: "asc" }, { nombre: "asc" }],
    });
  }

  async findOne(id: string) {
    const e = await this.prisma.extra.findUnique({ where: { id } });
    if (!e) throw new NotFoundException("Extra no encontrado");
    return e;
  }

  async update(id: string, dto: UpdateExtraDto) {
    await this.ensureExists(id);

    // si cambian nombre, normalizar
    const data: any = {
      ...dto,
      nombre: dto.nombre !== undefined ? this.normNombre(dto.nombre) : undefined,
      precio: dto.precio !== undefined ? Number(dto.precio) : undefined,
      stockActual: dto.stockActual !== undefined ? Number(dto.stockActual) : undefined,
      categoria: dto.categoria !== undefined ? this.normCategoria(dto.categoria) : undefined,
    };

    return this.prisma.extra.update({ where: { id }, data });
  }

  async setActivo(id: string, activo: boolean) {
    await this.ensureExists(id);
    return this.prisma.extra.update({ where: { id }, data: { activo: Boolean(activo) } });
  }

  async sumarStock(id: string, cantidad: number) {
    await this.ensureExists(id);
    const cant = Number(cantidad);
    if (!Number.isFinite(cant) || cant <= 0) throw new BadRequestException("Cantidad inválida");

    return this.prisma.extra.update({
      where: { id },
      data: { stockActual: { increment: cant } },
    });
  }

  async descontarStock(id: string, cantidad: number) {
    await this.ensureExists(id);
    const cant = Number(cantidad);
    if (!Number.isFinite(cant) || cant <= 0) throw new BadRequestException("Cantidad inválida");

    // chequeo + decrement atómico (evita stock negativo)
    const updated = await this.prisma.extra.updateMany({
      where: { id, stockActual: { gte: cant } },
      data: { stockActual: { decrement: cant } },
    });

    if (updated.count === 0) {
      throw new BadRequestException("Stock insuficiente");
    }

    return this.prisma.extra.findUnique({ where: { id } });
  }

  // delete real (si querés, dejalo solo para ADMIN)
  async remove(id: string) {
    await this.ensureExists(id);
    return this.prisma.extra.delete({ where: { id } });
  }

  private async ensureExists(id: string) {
    const e = await this.prisma.extra.findUnique({ where: { id }, select: { id: true } });
    if (!e) throw new NotFoundException("Extra no encontrado");
  }
}