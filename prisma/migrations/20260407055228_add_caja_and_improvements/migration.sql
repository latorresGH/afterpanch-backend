-- CreateEnum
CREATE TYPE "TipoMovimientoCaja" AS ENUM ('ENTRADA', 'SALIDA', 'AJUSTE');

-- AlterTable
ALTER TABLE "Pedido" ADD COLUMN     "apellidoCliente" TEXT,
ADD COLUMN     "costoEnvio" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PedidoDetalle" ADD COLUMN     "sinAderezos" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AderezoPrecio" (
    "id" TEXT NOT NULL,
    "aderezoId" TEXT NOT NULL,
    "categoriaId" TEXT NOT NULL,
    "precio" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "AderezoPrecio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CajaMovimiento" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT,
    "tipo" "TipoMovimientoCaja" NOT NULL,
    "montoTotal" DOUBLE PRECISION NOT NULL,
    "gananciaNegocio" DOUBLE PRECISION NOT NULL,
    "gananciaRepartidor" DOUBLE PRECISION NOT NULL,
    "descripcion" TEXT,
    "confirmadoPor" TEXT,
    "fechaConfirmacion" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CajaMovimiento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AderezoPrecio_aderezoId_categoriaId_key" ON "AderezoPrecio"("aderezoId", "categoriaId");

-- AddForeignKey
ALTER TABLE "AderezoPrecio" ADD CONSTRAINT "AderezoPrecio_aderezoId_fkey" FOREIGN KEY ("aderezoId") REFERENCES "Aderezo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AderezoPrecio" ADD CONSTRAINT "AderezoPrecio_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CajaMovimiento" ADD CONSTRAINT "CajaMovimiento_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE SET NULL ON UPDATE CASCADE;
