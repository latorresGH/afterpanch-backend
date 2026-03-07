-- CreateTable
CREATE TABLE "Aderezo" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "Aderezo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Aderezo_nombre_key" ON "Aderezo"("nombre");
