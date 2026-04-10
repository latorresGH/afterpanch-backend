import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NegocioConfigService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.inicializarPorDefecto();
  }

  async obtener(clave: string): Promise<string | null> {
    const config = await this.prisma.configuracion.findUnique({
      where: { clave },
    });
    return config?.valor || null;
  }

  async obtenerTodas() {
    return this.prisma.configuracion.findMany({
      orderBy: { clave: 'asc' },
    });
  }

  async establecer(clave: string, valor: string, descripcion?: string) {
    return this.prisma.configuracion.upsert({
      where: { clave },
      update: { valor, descripcion },
      create: { clave, valor, descripcion },
    });
  }

  async inicializarPorDefecto() {
    const defaults = [
      {
        clave: 'alias_transferencia',
        valor: 'after.panch',
        descripcion: 'Alias para recibir transferencias',
      },
      {
        clave: 'whatsapp_numero',
        valor: '',
        descripcion: 'Número de WhatsApp para contacto (con código de país)',
      },
      {
        clave: 'stock_bajo_umbral',
        valor: '10',
        descripcion: 'Umbral de stock bajo para advertencias',
      },
      {
        clave: 'delivery_precio_base',
        valor: '3000',
        descripcion: 'Precio base de delivery',
      },
    ];

    for (const item of defaults) {
      const existe = await this.prisma.configuracion.findUnique({
        where: { clave: item.clave },
      });
      if (!existe) {
        await this.prisma.configuracion.create({ data: item });
      }
    }
  }
}
