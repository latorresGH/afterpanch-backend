/*
  Warnings:

  - The values [EN_PREPARACION,LISTO,FINALIZADO] on the enum `EstadoPedido` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `mesaId` on the `Pedido` table. All the data in the column will be lost.
  - You are about to drop the `Mesa` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "EstadoPedido_new" AS ENUM ('PENDIENTE', 'EN_CAMINO', 'ENTREGADO', 'CANCELADO');
ALTER TABLE "public"."Pedido" ALTER COLUMN "estado" DROP DEFAULT;
ALTER TABLE "Pedido" ALTER COLUMN "estado" TYPE "EstadoPedido_new" USING ("estado"::text::"EstadoPedido_new");
ALTER TYPE "EstadoPedido" RENAME TO "EstadoPedido_old";
ALTER TYPE "EstadoPedido_new" RENAME TO "EstadoPedido";
DROP TYPE "public"."EstadoPedido_old";
ALTER TABLE "Pedido" ALTER COLUMN "estado" SET DEFAULT 'PENDIENTE';
COMMIT;

-- AlterEnum
ALTER TYPE "TipoPedido" ADD VALUE 'RETIRO';

-- DropForeignKey
ALTER TABLE "Pedido" DROP CONSTRAINT "Pedido_mesaId_fkey";

-- AlterTable
ALTER TABLE "Pedido" DROP COLUMN "mesaId";

-- DropTable
DROP TABLE "Mesa";
