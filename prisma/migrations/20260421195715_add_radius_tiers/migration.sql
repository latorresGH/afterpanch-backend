-- AlterEnum
ALTER TYPE "ShippingMode" ADD VALUE 'RADIUS_TIERS';

-- CreateTable
CREATE TABLE "ShippingRadiusTier" (
    "id" TEXT NOT NULL,
    "fromKm" DOUBLE PRECISION NOT NULL,
    "toKm" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingRadiusTier_pkey" PRIMARY KEY ("id")
);
