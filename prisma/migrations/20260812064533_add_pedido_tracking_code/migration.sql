-- AlterTable
ALTER TABLE "Pedido" ADD COLUMN     "trackingCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Pedido_trackingCode_key" ON "Pedido"("trackingCode");
