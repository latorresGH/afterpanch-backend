/*
  Warnings:

  - Added the required column `updatedAt` to the `Mesa` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Mesa" ADD COLUMN     "capacidad" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "cliente" TEXT,
ADD COLUMN     "comensales" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "posX" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "posY" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
