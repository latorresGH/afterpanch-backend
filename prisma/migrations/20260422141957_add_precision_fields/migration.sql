-- AlterTable
ALTER TABLE "GeocodingCache" ADD COLUMN     "precision" TEXT NOT NULL DEFAULT 'exact';

-- AlterTable
ALTER TABLE "Pedido" ADD COLUMN     "direccionPrecision" TEXT;
