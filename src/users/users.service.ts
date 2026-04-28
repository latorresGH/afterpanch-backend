import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  private normalizeEmail(email: string) {
    return (email || '').trim().toLowerCase();
  }

  async create(dto: CreateUserDto) {
    const email = this.normalizeEmail(dto.email);

    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new BadRequestException('Email ya registrado');

    const passwordHash = await bcrypt.hash(dto.password, 10);

    return this.prisma.user.create({
      data: {
        email,
        nombre: dto.nombre.trim(),
        password: passwordHash,
        role: dto.role ?? Role.TRABAJADOR,
      },
      select: {
        id: true,
        email: true,
        nombre: true,
        role: true,
        createdAt: true,
      },
    });
  }

  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        nombre: true,
        role: true,
        activo: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        nombre: true,
        role: true,
        createdAt: true,
      },
    });
    if (!u) throw new NotFoundException('Usuario no encontrado');
    return u;
  }

  // IMPORTANTE: para Auth necesitamos el password, así que este método NO hace select parcial
  async findByEmail(email: string) {
    const normalized = this.normalizeEmail(email);
    return this.prisma.user.findUnique({ where: { email: normalized } });
  }

  async findByRole(role: Role) {
    return this.prisma.user.findMany({
      where: { role },
      select: {
        id: true,
        email: true,
        nombre: true,
        role: true,
        activo: true,
        createdAt: true,
      },
      orderBy: { nombre: 'asc' },
    });
  }

  async contarPedidosEnCamino(repartidorId: string) {
    return this.prisma.pedido.count({
      where: {
        repartidorId,
        estado: 'EN_CAMINO',
      },
    });
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.ensureExists(id);

    const data: any = {};
    if (dto.nombre !== undefined) data.nombre = dto.nombre.trim();
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.activo !== undefined) data.activo = Boolean(dto.activo);

    if (dto.password !== undefined) {
      data.password = await bcrypt.hash(dto.password, 10);
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        nombre: true,
        role: true,
        activo: true,
        createdAt: true,
      },
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    return this.prisma.user.delete({ where: { id } });
  }

  private async ensureExists(id: string) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!u) throw new NotFoundException('Usuario no encontrado');
  }
}
