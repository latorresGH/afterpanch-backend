import { Module } from '@nestjs/common';
import { BarriosService } from './barrios.service';
import { BarriosController } from './barrios.controller';
import { NegocioConfigModule } from '../config/config.module';

/**
 * Importa `NegocioConfigModule` solo para el fallback de precio del alta: un
 * barrio que llega sin `precioEnvio` se crea con `delivery_precio_base` en vez
 * de romper. Ver `BarriosService.precioPorDefecto`.
 */
@Module({
  imports: [NegocioConfigModule],
  controllers: [BarriosController],
  providers: [BarriosService],
  exports: [BarriosService],
})
export class BarriosModule {}
