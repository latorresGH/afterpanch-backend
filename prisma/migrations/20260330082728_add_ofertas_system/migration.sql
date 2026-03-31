-- CreateEnum
CREATE TYPE "TipoOferta" AS ENUM ('DOS_POR_UNO', 'COMBO', 'DESCUENTO_PORCENTAJE', 'DESCUENTO_MONTO_FIJO');

-- CreateEnum
CREATE TYPE "EstadoOferta" AS ENUM ('ACTIVA', 'PAUSADA', 'VENCIDA');

-- CreateTable
CREATE TABLE "Oferta" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "tipo" "TipoOferta" NOT NULL,
    "estado" "EstadoOferta" NOT NULL DEFAULT 'ACTIVA',
    "fechaInicio" TIMESTAMP(3) NOT NULL,
    "fechaFin" TIMESTAMP(3),
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "porcentajeDescuento" DOUBLE PRECISION,
    "montoDescuento" DOUBLE PRECISION,
    "maxUsosPorCliente" INTEGER,
    "maxUsosTotales" INTEGER,
    "usosActuales" INTEGER NOT NULL DEFAULT 0,
    "diasAplicables" TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7',
    "horaInicio" TEXT,
    "horaFin" TEXT,
    "aplicaPorLinea" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Oferta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfertaProducto" (
    "id" TEXT NOT NULL,
    "ofertaId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "obligatorio" BOOLEAN NOT NULL DEFAULT false,
    "cantidadMin" INTEGER NOT NULL DEFAULT 1,
    "cantidadMax" INTEGER,
    "precioEspecial" DOUBLE PRECISION,

    CONSTRAINT "OfertaProducto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrupoCombo" (
    "id" TEXT NOT NULL,
    "ofertaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "obligatorio" BOOLEAN NOT NULL DEFAULT true,
    "cantidad" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "GrupoCombo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrupoOpcion" (
    "id" TEXT NOT NULL,
    "grupoComboId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,

    CONSTRAINT "GrupoOpcion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoOferta" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "ofertaId" TEXT NOT NULL,
    "pedidoDetalleId" TEXT,
    "precioOriginal" DOUBLE PRECISION NOT NULL,
    "precioFinal" DOUBLE PRECISION NOT NULL,
    "descuentoAplicado" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PedidoOferta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Oferta_activa_estado_idx" ON "Oferta"("activa", "estado");

-- CreateIndex
CREATE INDEX "Oferta_fechaInicio_fechaFin_idx" ON "Oferta"("fechaInicio", "fechaFin");

-- CreateIndex
CREATE UNIQUE INDEX "OfertaProducto_ofertaId_productoId_key" ON "OfertaProducto"("ofertaId", "productoId");

-- CreateIndex
CREATE UNIQUE INDEX "GrupoOpcion_grupoComboId_productoId_key" ON "GrupoOpcion"("grupoComboId", "productoId");

-- CreateIndex
CREATE UNIQUE INDEX "PedidoOferta_pedidoDetalleId_key" ON "PedidoOferta"("pedidoDetalleId");

-- CreateIndex
CREATE INDEX "PedidoOferta_pedidoId_idx" ON "PedidoOferta"("pedidoId");

-- CreateIndex
CREATE INDEX "PedidoOferta_ofertaId_idx" ON "PedidoOferta"("ofertaId");

-- AddForeignKey
ALTER TABLE "OfertaProducto" ADD CONSTRAINT "OfertaProducto_ofertaId_fkey" FOREIGN KEY ("ofertaId") REFERENCES "Oferta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfertaProducto" ADD CONSTRAINT "OfertaProducto_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrupoCombo" ADD CONSTRAINT "GrupoCombo_ofertaId_fkey" FOREIGN KEY ("ofertaId") REFERENCES "Oferta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrupoOpcion" ADD CONSTRAINT "GrupoOpcion_grupoComboId_fkey" FOREIGN KEY ("grupoComboId") REFERENCES "GrupoCombo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrupoOpcion" ADD CONSTRAINT "GrupoOpcion_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoOferta" ADD CONSTRAINT "PedidoOferta_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoOferta" ADD CONSTRAINT "PedidoOferta_ofertaId_fkey" FOREIGN KEY ("ofertaId") REFERENCES "Oferta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoOferta" ADD CONSTRAINT "PedidoOferta_pedidoDetalleId_fkey" FOREIGN KEY ("pedidoDetalleId") REFERENCES "PedidoDetalle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
