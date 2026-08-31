-- Backfill: todo extra OFRECIDO en una categoria pasa a tener su consumo cargado.
--
-- QUE ARREGLA. `PedidosService.getExtraConsumo` descuenta 1 y loguea un WARN
-- cuando no encuentra la fila (extra, categoria) en "ExtraConsumo". Ese 1 no
-- era una decision de nadie: era el fallback. A partir de esta migracion la
-- fila siempre existe, y el DTO/servicio impiden crear combinaciones nuevas
-- sin ella, asi que el fallback deja de alcanzarse por configuracion
-- incompleta.
--
-- POR QUE 1 Y NO OTRO VALOR. Es EXACTAMENTE lo que esos extras venian
-- descontando de hecho. El backfill no cambia el comportamiento de ninguna
-- venta: lo hace explicito. Los que en realidad consumen otra cosa (50 g de
-- cheddar, 30 ml de salsa) se ajustan a mano desde la ficha.
--
-- QUE ES "OFRECIDO". La misma definicion que usa
-- `AdminExtrasService.validarConsumoCompleto`:
--   - `esGlobal = true`  -> TODAS las categorias (un global ignora
--     "ExtraCategoria" y se ofrece en toda la carta).
--   - `esGlobal = false` -> las de "ExtraCategoria".
-- Sin filtrar por "Categoria"."activo": el descuento al vender busca por el
-- categoriaId del producto sin mirar si la categoria esta activa, asi que una
-- inactiva con productos igual caeria al default.
--
-- SEGURIDAD CONTRA LOS DATOS EXISTENTES
-- - Solo INSERT. No actualiza ni borra: un consumo ya cargado a mano no se
--   pisa nunca (lo garantiza el NOT EXISTS).
-- - Idempotente: correrla dos veces no inserta nada la segunda vez.
-- - No puede violar la unique [extraId, categoriaId]: el NOT EXISTS la cubre y
--   el UNION deduplica el caso de un extra global que ademas tenga filas en
--   "ExtraCategoria".
-- - "id" no tiene default en la base (lo genera el cliente Prisma), asi que se
--   provee con gen_random_uuid(), nativo desde PG13.
-- - Si no hay nada que arreglar, inserta 0 filas y no falla.
INSERT INTO "ExtraConsumo" ("id", "extraId", "categoriaId", "cantidadConsumo")
SELECT gen_random_uuid()::text, o."extraId", o."categoriaId", 1
FROM (
  SELECT e."id" AS "extraId", c."id" AS "categoriaId"
  FROM "Extra" e
  CROSS JOIN "Categoria" c
  WHERE e."esGlobal" = true

  UNION

  SELECT ec."extraId", ec."categoriaId"
  FROM "ExtraCategoria" ec
) o
WHERE NOT EXISTS (
  SELECT 1 FROM "ExtraConsumo" xc
  WHERE xc."extraId" = o."extraId"
    AND xc."categoriaId" = o."categoriaId"
);

-- Verificacion dura: si despues del INSERT queda UNA sola combinacion ofrecida
-- sin consumo, la migracion aborta y hace rollback en vez de dejar la base a
-- medio arreglar con la validacion nueva ya activa.
DO $$
DECLARE
  huecos int;
BEGIN
  SELECT COUNT(*) INTO huecos
  FROM (
    SELECT e."id" AS "extraId", c."id" AS "categoriaId"
    FROM "Extra" e CROSS JOIN "Categoria" c WHERE e."esGlobal" = true
    UNION
    SELECT ec."extraId", ec."categoriaId" FROM "ExtraCategoria" ec
  ) o
  WHERE NOT EXISTS (
    SELECT 1 FROM "ExtraConsumo" xc
    WHERE xc."extraId" = o."extraId" AND xc."categoriaId" = o."categoriaId"
  );

  IF huecos > 0 THEN
    RAISE EXCEPTION
      'Backfill incompleto: quedan % combinaciones extra-categoria sin consumo.', huecos;
  END IF;

  RAISE NOTICE 'Consumo por categoria: no queda ninguna combinacion ofrecida sin cargar.';
END $$;
