-- DropForeignKey
ALTER TABLE "StockMovimiento" DROP CONSTRAINT "StockMovimiento_insumoId_fkey";

-- AlterTable
ALTER TABLE "StockMovimiento" ADD COLUMN     "aderezoId" TEXT,
ADD COLUMN     "extraId" TEXT,
ALTER COLUMN "insumoId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "StockMovimiento_extraId_idx" ON "StockMovimiento"("extraId");

-- CreateIndex
CREATE INDEX "StockMovimiento_aderezoId_idx" ON "StockMovimiento"("aderezoId");

-- AddForeignKey
ALTER TABLE "StockMovimiento" ADD CONSTRAINT "StockMovimiento_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovimiento" ADD CONSTRAINT "StockMovimiento_extraId_fkey" FOREIGN KEY ("extraId") REFERENCES "Extra"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovimiento" ADD CONSTRAINT "StockMovimiento_aderezoId_fkey" FOREIGN KEY ("aderezoId") REFERENCES "Aderezo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
