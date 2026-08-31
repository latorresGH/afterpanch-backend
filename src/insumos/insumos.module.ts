import { Module } from '@nestjs/common';

import { AdminInsumosController } from './admin-insumos.controller';
import { AdminInsumosService } from './admin-insumos.service';
import { InsumosController } from './insumos.controller';
import { InsumosService } from './insumos.service';

/**
 * Dos controllers sobre el mismo dominio y a propósito, igual que en Productos:
 *
 * - `InsumosController` es el CRUD y los ajustes de stock, sobre /insumos.
 * - `AdminInsumosController` cuelga de /admin y es solo la pantalla del panel:
 *   agregados, filtros, orden y paginación resueltos en Postgres.
 *
 * Separados porque tienen público y forma distintos: uno devuelve entidades,
 * el otro una pantalla ya compuesta.
 */
@Module({
  controllers: [InsumosController, AdminInsumosController],
  providers: [InsumosService, AdminInsumosService],
  // El Home usa InsumosService para el contador de "bajo mínimo" sin duplicar
  // la query. AdminInsumosService se exporta porque InsumosService delega en
  // él el reporte de consumo viejo.
  exports: [InsumosService, AdminInsumosService],
})
export class InsumosModule {}
