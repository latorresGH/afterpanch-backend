import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBarrioDto, UpdateBarrioDto } from './dto/barrio.dto';

@Injectable()
export class BarriosService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateBarrioDto) {
    const existe = await this.prisma.barrio.findUnique({
      where: { nombre: dto.nombre.trim() },
    });
    if (existe) {
      throw new BadRequestException('Ya existe un barrio con ese nombre');
    }

    return this.prisma.barrio.create({
      data: {
        nombre: dto.nombre.trim(),
        precioEnvio: Number(dto.precioEnvio),
        activo: dto.activo ?? true,
      },
    });
  }

  async findAll(activo?: boolean) {
    const where = activo !== undefined ? { activo } : {};
    return this.prisma.barrio.findMany({
      where,
      orderBy: { nombre: 'asc' },
    });
  }

  async findOne(id: string) {
    const barrio = await this.prisma.barrio.findUnique({ where: { id } });
    if (!barrio) throw new NotFoundException('Barrio no encontrado');
    return barrio;
  }

  async update(id: string, dto: UpdateBarrioDto) {
    await this.findOne(id);

    const data: any = {};
    if (dto.nombre !== undefined) data.nombre = dto.nombre.trim();
    if (dto.precioEnvio !== undefined) data.precioEnvio = Number(dto.precioEnvio);
    if (dto.activo !== undefined) data.activo = Boolean(dto.activo);

    return this.prisma.barrio.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.barrio.delete({ where: { id } });
  }
}
