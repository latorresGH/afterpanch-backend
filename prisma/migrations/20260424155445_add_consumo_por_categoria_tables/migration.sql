-- CreateTable
CREATE TABLE "ExtraConsumo" (
    "id" TEXT NOT NULL,
    "extraId" TEXT NOT NULL,
    "categoriaId" TEXT NOT NULL,
    "cantidadConsumo" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ExtraConsumo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AderezoConsumo" (
    "id" TEXT NOT NULL,
    "aderezoId" TEXT NOT NULL,
    "categoriaId" TEXT NOT NULL,
    "cantidadConsumo" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "AderezoConsumo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExtraConsumo_extraId_categoriaId_key" ON "ExtraConsumo"("extraId", "categoriaId");

-- CreateIndex
CREATE UNIQUE INDEX "AderezoConsumo_aderezoId_categoriaId_key" ON "AderezoConsumo"("aderezoId", "categoriaId");

-- AddForeignKey
ALTER TABLE "ExtraConsumo" ADD CONSTRAINT "ExtraConsumo_extraId_fkey" FOREIGN KEY ("extraId") REFERENCES "Extra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraConsumo" ADD CONSTRAINT "ExtraConsumo_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AderezoConsumo" ADD CONSTRAINT "AderezoConsumo_aderezoId_fkey" FOREIGN KEY ("aderezoId") REFERENCES "Aderezo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AderezoConsumo" ADD CONSTRAINT "AderezoConsumo_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE CASCADE ON UPDATE CASCADE;
