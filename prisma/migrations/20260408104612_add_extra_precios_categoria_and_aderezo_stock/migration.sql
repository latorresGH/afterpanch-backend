-- AlterTable
ALTER TABLE "Aderezo" ADD COLUMN     "activo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "stockActual" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ExtraPrecio" (
    "id" TEXT NOT NULL,
    "extraId" TEXT NOT NULL,
    "categoriaId" TEXT NOT NULL,
    "precio" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ExtraPrecio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExtraPrecio_extraId_categoriaId_key" ON "ExtraPrecio"("extraId", "categoriaId");

-- AddForeignKey
ALTER TABLE "ExtraPrecio" ADD CONSTRAINT "ExtraPrecio_extraId_fkey" FOREIGN KEY ("extraId") REFERENCES "Extra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraPrecio" ADD CONSTRAINT "ExtraPrecio_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE CASCADE ON UPDATE CASCADE;
