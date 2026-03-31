import { Module } from '@nestjs/common';
import { PedidosService } from './pedidos.service';
import { PedidosController } from './pedidos.controller';
import { OfertasModule } from '../ofertas/ofertas.module';

@Module({
  imports: [OfertasModule],
  controllers: [PedidosController],
  providers: [PedidosService],
})
export class PedidosModule {}
