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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
