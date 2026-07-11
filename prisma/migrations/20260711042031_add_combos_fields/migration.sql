-- AlterTable
ALTER TABLE "Oferta" ADD COLUMN     "imagenUrl" TEXT,
ADD COLUMN     "orden" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "precio" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "OfertaProducto" ADD COLUMN     "orden" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PedidoDetalle" ADD COLUMN     "comboId" TEXT,
ADD COLUMN     "comboInstanciaId" TEXT;

-- CreateIndex
CREATE INDEX "PedidoDetalle_comboInstanciaId_idx" ON "PedidoDetalle"("comboInstanciaId");
