import { Module } from '@nestjs/common';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';
import { CajaModule } from '../caja/caja.module';
import { NegocioConfigModule } from '../config/config.module';
import { InsumosModule } from '../insumos/insumos.module';
import { OfertasModule } from '../ofertas/ofertas.module';
import { PedidosModule } from '../pedidos/pedidos.module';
import { UsersModule } from '../users/users.module';

/**
 * El Home no tiene dominio propio: solo compone lo que exponen los modulos que
 * ya existen. Por eso importa services y no duplica ninguna query.
 */
@Module({
  imports: [
    CajaModule,
    NegocioConfigModule,
    InsumosModule,
    OfertasModule,
    PedidosModule,
    UsersModule,
  ],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
