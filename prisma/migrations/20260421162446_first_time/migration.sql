-- AlterTable
ALTER TABLE "Categoria" ADD COLUMN     "orden" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Producto" ADD COLUMN     "imagenUrl" TEXT;

-- CreateTable
CREATE TABLE "ExtraCategoria" (
    "id" TEXT NOT NULL,
    "extraId" TEXT NOT NULL,
    "categoriaId" TEXT NOT NULL,

    CONSTRAINT "ExtraCategoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AderezoCategoria" (
    "id" TEXT NOT NULL,
    "aderezoId" TEXT NOT NULL,
    "categoriaId" TEXT NOT NULL,

    CONSTRAINT "AderezoCategoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExtraCategoria_extraId_categoriaId_key" ON "ExtraCategoria"("extraId", "categoriaId");

-- CreateIndex
CREATE UNIQUE INDEX "AderezoCategoria_aderezoId_categoriaId_key" ON "AderezoCategoria"("aderezoId", "categoriaId");

-- AddForeignKey
ALTER TABLE "ExtraCategoria" ADD CONSTRAINT "ExtraCategoria_extraId_fkey" FOREIGN KEY ("extraId") REFERENCES "Extra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraCategoria" ADD CONSTRAINT "ExtraCategoria_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AderezoCategoria" ADD CONSTRAINT "AderezoCategoria_aderezoId_fkey" FOREIGN KEY ("aderezoId") REFERENCES "Aderezo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AderezoCategoria" ADD CONSTRAINT "AderezoCategoria_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE CASCADE ON UPDATE CASCADE;
