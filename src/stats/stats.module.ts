import { Module } from '@nestjs/common';

import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { CajaModule } from '../caja/caja.module';
import { PedidosModule } from '../pedidos/pedidos.module';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Como el Home, Estadisticas no tiene dominio propio: reusa CajaService para
 * el resumen del periodo y PedidosService para la serie diaria y el pendiente
 * de cobro, en vez de repetir esas queries.
 *
 * Lo que si consulta directo por Prisma son los agregados que no son de nadie
 * en particular (cortes por estado/tipo/metodo, ranking de productos, maridaje
 * y extras): viven aca porque solo los usa este panel, y meterlos en los
 * services de dominio les agregaria superficie que ninguna otra pantalla pide.
 */
@Module({
  imports: [PrismaModule, CajaModule, PedidosModule],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
