-- Integridad e indices de ProductoReceta (seccion Productos del admin).
--
-- La tabla venia con la PK y nada mas: ni unicidad de (producto, insumo) ni
-- indices sobre las dos columnas de FK (Postgres no los crea solo).
--
-- Todo es aditivo: no toca datos, no hay backfill. Lo unico que puede fallar
-- es la UNIQUE si la base ya tiene recetas con el mismo insumo repetido, y por
-- eso el bloque de abajo corta antes con un mensaje entendible en vez de
-- dejar la migracion a medio aplicar.

-- Chequeo previo: si hay duplicados, la migracion aborta ANTES de crear nada.
-- Para verlos:
--   SELECT "productoId", "insumoId", COUNT(*)
--   FROM "ProductoReceta" GROUP BY 1, 2 HAVING COUNT(*) > 1;
-- Se resuelven consolidando las filas repetidas en una sola (sumando o
-- eligiendo la cantidad correcta), nunca borrando a ciegas: cada fila de mas
-- estaba descontando stock de verdad en cada venta.
DO $$
DECLARE
  duplicados int;
BEGIN
  SELECT COUNT(*) INTO duplicados
  FROM (
    SELECT 1
    FROM "ProductoReceta"
    GROUP BY "productoId", "insumoId"
    HAVING COUNT(*) > 1
  ) t;

  IF duplicados > 0 THEN
    RAISE EXCEPTION
      'ProductoReceta tiene % combinacion(es) (productoId, insumoId) duplicadas. Consolidalas a mano antes de aplicar esta migracion.',
      duplicados;
  END IF;
END $$;

-- Un insumo entra UNA vez por producto. Sin esto, dos filas del mismo insumo
-- en una receta hacen que la venta descuente el stock dos veces.
CREATE UNIQUE INDEX "ProductoReceta_productoId_insumoId_key"
  ON "ProductoReceta"("productoId", "insumoId");

-- Nota: este indice es redundante con la UNIQUE de arriba, que ya lleva
-- "productoId" como columna lider y resuelve igual de bien los filtros y
-- borrados por producto. Se crea porque el schema lo declara explicito; si en
-- algun momento molesta el costo de escritura:
--   DROP INDEX "ProductoReceta_productoId_idx";
CREATE INDEX "ProductoReceta_productoId_idx" ON "ProductoReceta"("productoId");

-- Este si hacia falta: es el lado que ninguna otra estructura cubria. Lo usa
-- todo lo que va del insumo hacia sus productos (validar borrado de un insumo,
-- ver en que recetas participa).
CREATE INDEX "ProductoReceta_insumoId_idx" ON "ProductoReceta"("insumoId");
