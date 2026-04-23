-- CreateEnum
CREATE TYPE "ShippingMode" AS ENUM ('RADIUS', 'POLYGON');

-- AlterTable
ALTER TABLE "Pedido" ADD COLUMN     "departamento" TEXT,
ADD COLUMN     "direccionFormateada" TEXT,
ADD COLUMN     "direccionLat" DOUBLE PRECISION,
ADD COLUMN     "direccionLng" DOUBLE PRECISION,
ADD COLUMN     "notasRepartidor" TEXT,
ADD COLUMN     "piso" TEXT,
ADD COLUMN     "referencias" TEXT,
ADD COLUMN     "shippingReason" TEXT,
ADD COLUMN     "shippingZoneName" TEXT;

-- CreateTable
CREATE TABLE "ShippingConfig" (
    "id" TEXT NOT NULL,
    "mode" "ShippingMode" NOT NULL DEFAULT 'RADIUS',
    "localLat" DOUBLE PRECISION NOT NULL,
    "localLng" DOUBLE PRECISION NOT NULL,
    "radiusKm" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "radiusPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxDeliveryRadiusKm" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "borderToleranceMeters" INTEGER NOT NULL DEFAULT 500,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingZone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "polygon" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeocodingCache" (
    "id" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "formattedAddress" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "hitCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeocodingCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GeocodingCache_normalizedKey_key" ON "GeocodingCache"("normalizedKey");

-- CreateIndex
CREATE INDEX "GeocodingCache_normalizedKey_idx" ON "GeocodingCache"("normalizedKey");
