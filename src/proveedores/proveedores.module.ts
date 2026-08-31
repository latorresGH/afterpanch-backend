import { Module } from '@nestjs/common';

import { AdminProveedoresController } from './admin-proveedores.controller';
import { AdminProveedoresService } from './admin-proveedores.service';
import { ProveedoresService } from './proveedores.service';
import { ProveedoresController } from './proveedores.controller';

/**
 * Dos controllers sobre el mismo dominio, igual que en Insumos y Productos:
 *
 * - `AdminProveedoresController` cuelga de /admin/proveedores y es la seccion
 *   nueva: la pantalla ya compuesta (agregados, filtros, orden y paginacion
 *   resueltos en Postgres) mas el ABM con archivar/reactivar.
 * - `ProveedoresController`, sobre /proveedores, es el CRUD viejo. Sigue en
 *   pie SOLO porque la pantalla vieja del panel todavia le pega (`useProveedores`).
 *   Se borra junto con esa pantalla cuando entre el front nuevo; hasta
 *   entonces no se toca, para no romper lo que hay corriendo.
 */
@Module({
  controllers: [ProveedoresController, AdminProveedoresController],
  providers: [ProveedoresService, AdminProveedoresService],
  exports: [AdminProveedoresService],
})
export class ProveedoresModule {}
