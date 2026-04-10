-- AlterTable
ALTER TABLE "Extra" ADD COLUMN     "insumoId" TEXT;

-- AddForeignKey
ALTER TABLE "Extra" ADD CONSTRAINT "Extra_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
