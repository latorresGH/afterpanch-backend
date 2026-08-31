import { Module } from '@nestjs/common';

import { AdminProductosController } from './admin-productos.controller';
import { AdminProductosService } from './admin-productos.service';
import { ProductosController } from './productos.controller';
import { ProductosService } from './productos.service';

/**
 * Dos controllers sobre el mismo dominio y a proposito:
 *
 * - `ProductosController` es el CRUD y el menu, con su parte publica.
 * - `AdminProductosController` cuelga de /admin y es solo la pantalla del
 *   panel: agregados, filtros y paginacion, igual que /admin/home y
 *   /admin/estadisticas.
 *
 * Separados porque tienen publico y forma distintos: uno devuelve entidades,
 * el otro una pantalla ya compuesta.
 */
@Module({
  controllers: [ProductosController, AdminProductosController],
  providers: [ProductosService, AdminProductosService],
})
export class ProductosModule {}
