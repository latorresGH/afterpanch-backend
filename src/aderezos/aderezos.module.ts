import { Module } from '@nestjs/common';

import { AderezosController } from './aderezos.controller';
import { AderezosService } from './aderezos.service';
import { AdminAderezosController } from './admin-aderezos.controller';
import { AdminAderezosService } from './admin-aderezos.service';

/**
 * Dos controllers sobre el mismo dominio, igual que en Insumos, Productos,
 * Proveedores y Extras:
 *
 * - `AderezosController`, sobre /aderezos, es el CRUD viejo y —lo importante—
 *   los endpoints @Public() que consumen la carta y el POS
 *   (`GET /aderezos`, `por-categoria-producto`, `por-categoria-con-stock`).
 *   Ademas la seccion de Productos ya reworkeada le pide `GET /aderezos`. NO
 *   SE CAMBIA DE FORMA: alterar su shape rompe tres consumidores a la vez. Lo
 *   unico que se toco es lo que estaba mal por dentro (el default de 999, el
 *   `limit` sin clamp, los bodies sin DTO y el borrado sin guard).
 * - `AdminAderezosController` cuelga de /admin/aderezos y es solo la pantalla
 *   del panel: agregados, filtros, orden y paginacion resueltos en Postgres,
 *   mas el ABM con el consumo por categoria.
 */
@Module({
  controllers: [AderezosController, AdminAderezosController],
  providers: [AderezosService, AdminAderezosService],
  exports: [AdminAderezosService],
})
export class AderezosModule {}
