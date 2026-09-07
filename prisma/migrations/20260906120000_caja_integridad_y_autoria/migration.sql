-- Integridad y autoria de CajaMovimiento.
--
-- Cubre dos de los cuatro bugs de plata de la seccion Caja:
--
--   1. DOBLE COBRO: la tabla no tenia ninguna restriccion de unicidad sobre
--      "pedidoId". Lo unico que impedia cobrar dos veces el mismo pedido era
--      un findFirst adentro de la transaccion de registrarPagoPedido, y con
--      Postgres en READ COMMITTED eso no alcanza: dos confirmaciones
--      concurrentes del mismo pedido (dos personas, un doble click, el Home y
--      el POS a la vez) leen las dos "no hay movimiento" y las dos insertan.
--      La venta quedaba contada dos veces en el resumen de caja.
--
--   3. AUTORIA: "confirmadoPor" es texto libre que hasta ahora llegaba del
--      body de la request. El front mandaba los literales 'Admin' y 'POS', y
--      cualquiera con sesion podia mandar el nombre que quisiera. No habia
--      forma de responder "quien cobro este pedido".
--
-- TODO ES ADITIVO: no borra ni reescribe una sola fila. La columna nueva nace
-- NULL en todo el historico (el dato no es reconstruible hacia atras: 'Admin'
-- y 'POS' no identifican a nadie) y "confirmadoPor" se conserva intacto como
-- snapshot de texto.
--
-- Lo unico que puede fallar es la UNIQUE, si la base ya viene con el doble
-- cobro consumado. Por eso el bloque de abajo corta ANTES de crear nada, con
-- un mensaje entendible, en vez de dejar la migracion a medio aplicar.

-- Chequeo previo: si ya hay pedidos con dos movimientos del mismo tipo, esto
-- aborta la migracion entera (la transaccion se revierte) sin tocar nada.
-- Para verlos:
--   SELECT "pedidoId", "tipo", COUNT(*), SUM("montoTotal")
--   FROM "CajaMovimiento"
--   WHERE "pedidoId" IS NOT NULL
--   GROUP BY 1, 2 HAVING COUNT(*) > 1;
--
-- Se resuelven a mano y NUNCA borrando a ciegas: cada fila de mas es plata
-- que el resumen conto dos veces, asi que hay que quedarse con la primera
-- (menor "fechaConfirmacion") y borrar las demas, despues de confirmar contra
-- el pedido que el monto duplicado no correspondia a un cobro real distinto.
DO $$
DECLARE
  duplicados int;
BEGIN
  SELECT COUNT(*) INTO duplicados
  FROM (
    SELECT 1
    FROM "CajaMovimiento"
    WHERE "pedidoId" IS NOT NULL
    GROUP BY "pedidoId", "tipo"
    HAVING COUNT(*) > 1
  ) t;

  IF duplicados > 0 THEN
    RAISE EXCEPTION
      'CajaMovimiento tiene % pedido(s) con movimientos duplicados del mismo tipo (doble cobro ya consumado). Resolvelos a mano antes de aplicar esta migracion: SELECT "pedidoId", "tipo", COUNT(*) FROM "CajaMovimiento" WHERE "pedidoId" IS NOT NULL GROUP BY 1,2 HAVING COUNT(*) > 1;',
      duplicados;
  END IF;
END $$;

-- AlterTable
ALTER TABLE "CajaMovimiento" ADD COLUMN     "registradoPorId" TEXT;

-- CreateIndex
--
-- Es (pedidoId, tipo) y no pedidoId solo por dos razones:
--   a. Deja lugar a una SALIDA sobre el mismo pedido (una devolucion) sin
--      chocar con su ENTRADA, que es lo unico que hay que impedir.
--   b. Con "pedidoId" solo, Prisma leeria la relacion como 1-1 y obligaria a
--      cambiar Pedido.movimientosCaja de lista a objeto, rompiendo el
--      `movimientosCaja: { none: ... }` de pedidos y el `.some(...)` del front.
--
-- Los movimientos manuales (pedidoId NULL) no quedan limitados: en Postgres
-- una UNIQUE con un NULL adentro no colisiona nunca (NULLS DISTINCT), asi que
-- se pueden seguir registrando todos los gastos que haga falta.
CREATE UNIQUE INDEX "CajaMovimiento_pedidoId_tipo_key" ON "CajaMovimiento"("pedidoId", "tipo");

-- AddForeignKey
--
-- ON DELETE SET NULL a proposito: borrar un empleado no puede borrar ni
-- bloquear el historico de caja. El movimiento sobrevive con
-- "registradoPorId" en NULL y "confirmadoPor" como unico rastro del nombre.
ALTER TABLE "CajaMovimiento" ADD CONSTRAINT "CajaMovimiento_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
