-- Indices para la seccion de Insumos/Stock del admin (GET /admin/insumos).
--
-- Los tres son aditivos: no tocan datos, no hay backfill, y solo toman el
-- ACCESS EXCLUSIVE momentaneo de la creacion. Seguros contra los datos
-- existentes por construccion: crear un indice no puede fallar por contenido
-- (no hay unicidad de por medio).

-- Postgres NO crea indices sobre las columnas de foreign key. "proveedorId"
-- venia sin nada desde que se agrego la relacion: el filtro por proveedor del
-- panel y el conteo que valida el borrado de un Proveedor hacian seq scan.
CREATE INDEX "Insumo_proveedorId_idx" ON "Insumo"("proveedorId");

-- Historial de UN insumo ordenado por fecha (el modal de historial) y su
-- consumo dentro de un rango. El "StockMovimiento_insumoId_idx" que ya existe
-- encuentra las filas del insumo pero deja el ORDER BY / el rango de fecha
-- para despues; con el compuesto sale todo del indice.
CREATE INDEX "StockMovimiento_insumoId_createdAt_idx"
  ON "StockMovimiento"("insumoId", "createdAt");

-- Reporte de consumo por rango: igualdad en tipo ('DESCUENTO_PEDIDO') mas
-- rango en fecha. El orden importa: la columna de igualdad va primera para que
-- el rango se resuelva sobre un tramo contiguo. No reemplaza a
-- "StockMovimiento_createdAt_idx": con "tipo" sin restringir, este no sirve.
CREATE INDEX "StockMovimiento_tipo_createdAt_idx"
  ON "StockMovimiento"("tipo", "createdAt");
