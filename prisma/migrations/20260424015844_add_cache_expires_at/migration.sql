-- AlterTable
ALTER TABLE "GeocodingCache" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "GeocodingCache_expiresAt_idx" ON "GeocodingCache"("expiresAt");
