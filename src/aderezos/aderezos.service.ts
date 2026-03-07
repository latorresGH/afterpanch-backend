// src/aderezos/aderezos.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service'; // Asegúrate de que la ruta sea correcta
import { CreateAderezoDto } from './dto/create-aderezo.dto';

@Injectable()
export class AderezosService {
  constructor(private prisma: PrismaService) {}

  async create(createAderezoDto: CreateAderezoDto) {
    return this.prisma.aderezo.create({
      data: createAderezoDto,
    });
  }

  async findAll() {
    return this.prisma.aderezo.findMany({
      orderBy: { nombre: 'asc' },
    });
  }

  async remove(id: string) {
    return this.prisma.aderezo.delete({
      where: { id },
    });
  }
}