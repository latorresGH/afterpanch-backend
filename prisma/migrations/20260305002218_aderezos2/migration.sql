-- CreateTable
CREATE TABLE "_AderezoToPedidoDetalle" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AderezoToPedidoDetalle_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_AderezoToPedidoDetalle_B_index" ON "_AderezoToPedidoDetalle"("B");

-- AddForeignKey
ALTER TABLE "_AderezoToPedidoDetalle" ADD CONSTRAINT "_AderezoToPedidoDetalle_A_fkey" FOREIGN KEY ("A") REFERENCES "Aderezo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AderezoToPedidoDetalle" ADD CONSTRAINT "_AderezoToPedidoDetalle_B_fkey" FOREIGN KEY ("B") REFERENCES "PedidoDetalle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
