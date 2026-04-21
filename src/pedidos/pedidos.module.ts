import { Module } from '@nestjs/common';
import { PedidosService } from './pedidos.service';
import { PedidosController } from './pedidos.controller';
import { PedidosGateway } from './pedidos.gateway';
import { OfertasModule } from '../ofertas/ofertas.module';
import { NegocioConfigModule } from '../config/config.module';

@Module({
  imports: [OfertasModule, NegocioConfigModule],
  controllers: [PedidosController],
  providers: [PedidosService, PedidosGateway],
})
export class PedidosModule {}
