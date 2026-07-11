-- DropIndex
DROP INDEX "OfertaProducto_ofertaId_productoId_key";

-- CreateIndex
CREATE UNIQUE INDEX "OfertaProducto_ofertaId_productoId_orden_key" ON "OfertaProducto"("ofertaId", "productoId", "orden");

