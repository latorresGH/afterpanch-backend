import { Module } from '@nestjs/common';
import { PedidosService } from './pedidos.service';
import { PedidosController } from './pedidos.controller';
import { PedidosGateway } from './pedidos.gateway';
import { OfertasModule } from '../ofertas/ofertas.module';
import { NegocioConfigModule } from '../config/config.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [OfertasModule, NegocioConfigModule, AuthModule, UsersModule],
  controllers: [PedidosController],
  providers: [PedidosService, PedidosGateway],
  // Los consume HomeModule (GET /admin/home).
  exports: [PedidosService, PedidosGateway],
})
export class PedidosModule {}
