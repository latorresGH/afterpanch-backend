-- Indices para la seccion de Estadisticas del admin (GET /admin/estadisticas).
--
-- Postgres NO crea indices automaticos sobre las columnas de foreign key, asi
-- que las dos de PedidoDetalle venian sin nada desde el init: cualquier
-- agregado de top productos o de maridaje hacia seq scan sobre la tabla mas
-- grande del sistema. CajaMovimiento directamente no tenia ningun indice.
--
-- Los cuatro son aditivos: no tocan datos, no hay backfill, y solo toman el
-- ACCESS EXCLUSIVE momentaneo de la creacion.

-- Joins Pedido -> PedidoDetalle de todos los bloques de producto/extras.
CREATE INDEX "PedidoDetalle_pedidoId_idx" ON "PedidoDetalle"("pedidoId");

-- Agrupado por producto (top productos) y el GET /productos/:id/stats que ya
-- estaba en produccion filtrando por esta columna sin indice.
CREATE INDEX "PedidoDetalle_productoId_idx" ON "PedidoDetalle"("productoId");

-- Consultas de caja que filtran SOLO por fecha: la lista de movimientos del
-- Home y el "mejor dia" del periodo, que agrupa sin discriminar tipo.
CREATE INDEX "CajaMovimiento_fechaConfirmacion_idx" ON "CajaMovimiento"("fechaConfirmacion");

-- Compuesto para getResumenAgregado, que es igualdad en tipo + rango en fecha
-- (ENTRADA/SALIDA dentro del periodo). El orden importa: la columna de
-- igualdad va primera para que el rango se resuelva sobre un tramo contiguo.
-- No reemplaza al indice de arriba: con "tipo" sin restringir, este no sirve.
CREATE INDEX "CajaMovimiento_tipo_fechaConfirmacion_idx" ON "CajaMovimiento"("tipo", "fechaConfirmacion");
