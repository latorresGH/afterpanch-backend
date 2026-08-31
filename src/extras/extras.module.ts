import { Module } from '@nestjs/common';

import { AdminExtrasController } from './admin-extras.controller';
import { AdminExtrasService } from './admin-extras.service';
import { ExtrasController } from './extras.controller';
import { ExtrasService } from './extras.service';

/**
 * Dos controllers sobre el mismo dominio, igual que en Insumos, Productos y
 * Proveedores:
 *
 * - `ExtrasController`, sobre /extras, es el CRUD viejo y —lo importante— los
 *   endpoints @Public() que consumen la carta y el POS
 *   (`por-categoria-producto`, `por-categoria-con-stock`). Ademas la seccion
 *   de Productos ya reworkeada le pide `GET /extras`. NO SE TOCA: cambiarle la
 *   forma rompe tres consumidores a la vez.
 * - `AdminExtrasController` cuelga de /admin/extras y es solo la pantalla del
 *   panel: agregados, filtros, orden y paginacion resueltos en Postgres, mas
 *   el ABM con la configuracion por categoria.
 */
@Module({
  controllers: [ExtrasController, AdminExtrasController],
  providers: [ExtrasService, AdminExtrasService],
  exports: [AdminExtrasService],
})
export class ExtrasModule {}
