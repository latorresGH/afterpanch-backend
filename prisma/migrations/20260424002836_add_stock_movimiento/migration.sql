-- CreateTable
CREATE TABLE "StockMovimiento" (
    "id" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "cantidad" DOUBLE PRECISION NOT NULL,
    "stockAntes" DOUBLE PRECISION NOT NULL,
    "stockDespues" DOUBLE PRECISION NOT NULL,
    "pedidoId" TEXT,
    "motivo" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovimiento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockMovimiento_insumoId_idx" ON "StockMovimiento"("insumoId");

-- CreateIndex
CREATE INDEX "StockMovimiento_createdAt_idx" ON "StockMovimiento"("createdAt");

-- AddForeignKey
ALTER TABLE "StockMovimiento" ADD CONSTRAINT "StockMovimiento_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
