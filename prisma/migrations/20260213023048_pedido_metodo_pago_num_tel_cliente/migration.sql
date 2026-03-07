-- CreateEnum
CREATE TYPE "MetodoPago" AS ENUM ('EFECTIVO', 'TRANSFERENCIA', 'TARJETA');

-- AlterTable
ALTER TABLE "Pedido" ADD COLUMN     "metodoPago" "MetodoPago",
ADD COLUMN     "numeroCliente" TEXT;
