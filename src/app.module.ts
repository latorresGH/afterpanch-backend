import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InsumosModule } from './insumos/insumos.module';
import { ProductosModule } from './productos/productos.module';
import { PedidosModule } from './pedidos/pedidos.module';
import { PrismaModule } from './prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { CategoriasModule } from './categorias/categorias.module';
import { ProveedoresModule } from './proveedores/proveedores.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ExtrasModule } from './extras/extras.module';
import { AderezosModule } from './aderezos/aderezos.module';
import { OfertasModule } from './ofertas/ofertas.module';
import { CajaModule } from './caja/caja.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { NegocioConfigModule } from './config/config.module';

/**
 * Validación de variables de entorno críticas
 * Evita que la app inicie sin configuración esencial
 */
function validateEnv(config: Record<string, string>) {
  const required = ['DATABASE_URL', 'JWT_SECRET'];
  const missing = required.filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(`❌ Variables de entorno faltantes: ${missing.join(', ')}`);
  }

  if (config.JWT_SECRET.length < 16) {
    throw new Error('❌ JWT_SECRET debe tener al menos 16 caracteres');
  }

  console.log('✅ Variables de entorno validadas correctamente');
  return config;
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    // Rate limiting global: 100 requests por minuto por IP (suficiente para uso normal)
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    InsumosModule,
    ProductosModule,
    AuthModule,
    UsersModule,
    PedidosModule,
    PrismaModule,
    CategoriasModule,
    ProveedoresModule,
    ExtrasModule,
    AderezosModule,
    OfertasModule,
    CajaModule,
    NegocioConfigModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Aplicar throttler guard globalmente (solo en producción/desarrollo)
    ...(process.env.NODE_ENV === 'test'
      ? []
      : [
          {
            provide: APP_GUARD,
            useClass: ThrottlerGuard,
          },
        ]),
  ],
})
export class AppModule {}
