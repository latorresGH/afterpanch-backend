-- Las SALSAS pasan a tener la misma disciplina de stock que Insumos y Extras.
--
-- Son TRES cambios independientes que van juntos porque los tres son
-- prerrequisito de la pantalla nueva de /admin/aderezos y ninguno sirve solo:
--
--   1. "Aderezo"."stockMinimo"  -> la columna no existia. Sin ella no hay
--      forma de decir "esta salsa esta por reponerse": la unica distincion
--      posible era tener o no tener (stockActual > 0).
--   2. "Aderezo"."unidadMedida" -> existe pero esta en null en la mayoria de
--      las filas. Un consumo de "40" sin unidad no significa nada.
--   3. "AderezoConsumo"         -> falta la fila en combinaciones que SI se
--      ofrecen, y ahi `PedidosService.getAderezoConsumo` descuenta 1 a ciegas.
--
-- LO QUE ESTA MIGRACION NO HACE
-- - No toca "AderezoPrecio". Esa tabla esta MUERTA (0 filas) y las salsas son
--   gratis por decision de negocio: queda para deprecar y borrar aparte, no se
--   usa ni se expone.
-- - No toca la logica de descuento de stock. `getAderezoConsumo` queda
--   exactamente igual; lo unico que cambia es que ahora su fallback deja de
--   alcanzarse por configuracion incompleta.
-- - No normaliza los stockActual en 999. Ese numero venia de un default
--   hardcodeado (front y back) que se corrige en el codigo de este mismo
--   cambio; las pocas filas que lo tienen se ajustan a mano desde la ficha.

-- ---------------------------------------------------------------------------
-- 1) stockMinimo: umbral de aviso PROPIO de cada salsa.
-- ---------------------------------------------------------------------------
--
-- BACKFILL. La columna nace NOT NULL con DEFAULT 10, asi que las filas
-- existentes quedan todas en 10 en el mismo ALTER: no hace falta un UPDATE
-- aparte. El 10 es el mismo numero que recibieron los Extras en
-- 20260828000000_stock_minimo_por_extra, y por el mismo motivo: es el umbral
-- al que caia por defecto el 'stock_bajo_umbral' global que ya no existe.
--
-- SEGURIDAD CONTRA LOS DATOS EXISTENTES
-- - ADD COLUMN ... NOT NULL DEFAULT sobre Postgres 11+ NO reescribe la tabla:
--   el default se guarda en el catalogo y las filas viejas lo leen de ahi. Es
--   O(1) y toma un ACCESS EXCLUSIVE momentaneo, no un lock largo.
-- - No puede fallar por contenido: no hay unicidad, ni FK, ni CHECK, y todas
--   las filas reciben el mismo valor valido.
-- - Es aditiva pura: ninguna consulta existente selecciona esta columna, asi
--   que el codigo viejo sigue funcionando si el deploy queda a mitad de camino.
--
-- EFECTO VISIBLE (esperado, no es un bug): a partir de aca, toda salsa con
-- stockActual < 10 se muestra como "por reponer" en el panel. No cambia
-- ninguna regla de negocio — el descuento, la disponibilidad en el POS y la
-- carta siguen igual — solo aparece la alerta.
ALTER TABLE "Aderezo"
  ADD COLUMN "stockMinimo" DOUBLE PRECISION NOT NULL DEFAULT 10;

-- ---------------------------------------------------------------------------
-- 2) unidadMedida: ninguna salsa se queda sin unidad.
-- ---------------------------------------------------------------------------
--
-- POR QUE 'u'. Es el valor neutro de la lista (`UNIDADES_MEDIDA` en
-- src/insumos/unidades.ts) y es lo que la salsa venia siendo DE HECHO: sin
-- unidad, su consumo se leia como "tantas unidades". El backfill no cambia
-- ningun numero, le pone nombre al que ya habia. Las que consuman gramos o
-- mililitros se corrigen desde la ficha.
--
-- LA COLUMNA SIGUE SIENDO NULLABLE EN LA BASE, a proposito: lo obligatorio se
-- valida en el DTO y en el service (`CrearAderezoDto` / `EditarAderezoDto`).
-- Promoverla a NOT NULL es un cambio aparte y queda anotado como pendiente.
--
-- SEGURIDAD CONTRA LOS DATOS EXISTENTES
-- - Solo UPDATE sobre filas en null o en blanco: una unidad ya cargada no se
--   pisa nunca.
-- - Idempotente: correrla dos veces no toca nada la segunda vez.
-- - Los valores que YA existen ('g', 'ml') estan los dos en la lista blanca,
--   asi que ninguna salsa queda ineditable por unidad invalida.
UPDATE "Aderezo"
SET "unidadMedida" = 'u'
WHERE "unidadMedida" IS NULL
   OR btrim("unidadMedida") = '';

-- ---------------------------------------------------------------------------
-- 3) Consumo por categoria: donde la salsa se ofrece, dice cuanto descuenta.
-- ---------------------------------------------------------------------------
--
-- QUE ARREGLA. `PedidosService.getAderezoConsumo` descuenta 1 y loguea un WARN
-- cuando no encuentra la fila (aderezo, categoria) en "AderezoConsumo". Ese 1
-- no era una decision de nadie: era el fallback. A partir de aca la fila
-- siempre existe, y el DTO/servicio impiden crear combinaciones nuevas sin
-- ella, asi que el fallback deja de alcanzarse por configuracion incompleta.
--
-- POR QUE 1 Y NO OTRO VALOR. Es EXACTAMENTE lo que esas salsas venian
-- descontando de hecho. El backfill no cambia el comportamiento de ninguna
-- venta: lo hace explicito.
--
-- QUE ES "OFRECIDA". La misma definicion que usa
-- `AdminAderezosService.validarConsumoCompleto`, y la misma que se uso para
-- los Extras en 20260828100000:
--   - `esGlobal = true`  -> TODAS las categorias (una global ignora
--     "AderezoCategoria" y se ofrece en toda la carta).
--   - `esGlobal = false` -> las de "AderezoCategoria".
-- Sin filtrar por "Categoria"."activo": el descuento al vender busca por el
-- categoriaId del producto sin mirar si la categoria esta activa, asi que una
-- inactiva con productos igual caeria al default.
--
-- OJO CON LO QUE NO ENTRA: una salsa que no es global y no tiene ninguna fila
-- en "AderezoCategoria" NO SE OFRECE EN NINGUN LADO, asi que no recibe nada.
-- No es un olvido: cargarle consumos a algo que nadie ve seria inventar
-- configuracion. La pantalla las marca aparte, con el filtro SIN_ALCANCE.
--
-- SEGURIDAD CONTRA LOS DATOS EXISTENTES
-- - Solo INSERT. No actualiza ni borra: un consumo ya cargado a mano no se
--   pisa nunca (lo garantiza el NOT EXISTS).
-- - Idempotente: correrla dos veces no inserta nada la segunda vez.
-- - No puede violar la unique [aderezoId, categoriaId]: el NOT EXISTS la cubre
--   y el UNION deduplica el caso de una salsa global que ademas tenga filas en
--   "AderezoCategoria".
-- - "id" no tiene default en la base (lo genera el cliente Prisma), asi que se
--   provee con gen_random_uuid(), nativo desde PG13.
-- - Si no hay nada que arreglar, inserta 0 filas y no falla.
INSERT INTO "AderezoConsumo" ("id", "aderezoId", "categoriaId", "cantidadConsumo")
SELECT gen_random_uuid()::text, o."aderezoId", o."categoriaId", 1
FROM (
  SELECT a."id" AS "aderezoId", c."id" AS "categoriaId"
  FROM "Aderezo" a
  CROSS JOIN "Categoria" c
  WHERE a."esGlobal" = true

  UNION

  SELECT ac."aderezoId", ac."categoriaId"
  FROM "AderezoCategoria" ac
) o
WHERE NOT EXISTS (
  SELECT 1 FROM "AderezoConsumo" x
  WHERE x."aderezoId" = o."aderezoId"
    AND x."categoriaId" = o."categoriaId"
);

-- Un consumo en 0 (o negativo) es indistinguible de no tenerlo configurado: la
-- salsa se ofreceria sin descontar nada. La validacion nueva lo prohibe de
-- entrada; esto arregla lo que ya pudiera estar guardado asi.
UPDATE "AderezoConsumo"
SET "cantidadConsumo" = 1
WHERE "cantidadConsumo" <= 0;

-- ---------------------------------------------------------------------------
-- 4) Indice para el historial y el consumo por salsa.
-- ---------------------------------------------------------------------------
--
-- La pantalla nueva pide dos cosas sobre "StockMovimiento": los movimientos de
-- UNA salsa ordenados por fecha (el modal de historial) y su consumo dentro de
-- una ventana. El indice simple de [aderezoId] que ya existe no alcanza:
-- obliga a leer todas las filas de la salsa y recien despues ordenar. Es el
-- mismo indice que ya tienen los insumos en [insumoId, createdAt].
CREATE INDEX IF NOT EXISTS "StockMovimiento_aderezoId_createdAt_idx"
  ON "StockMovimiento"("aderezoId", "createdAt");

-- ---------------------------------------------------------------------------
-- Verificacion dura.
-- ---------------------------------------------------------------------------
--
-- Si despues de todo lo anterior queda UNA sola salsa sin unidad o UNA sola
-- combinacion ofrecida sin consumo, la migracion aborta y hace rollback en vez
-- de dejar la base a medio arreglar con la validacion nueva ya activa.
DO $$
DECLARE
  sin_unidad int;
  sin_consumo int;
BEGIN
  SELECT COUNT(*) INTO sin_unidad
  FROM "Aderezo"
  WHERE "unidadMedida" IS NULL OR btrim("unidadMedida") = '';

  IF sin_unidad > 0 THEN
    RAISE EXCEPTION
      'Backfill incompleto: quedan % salsas sin unidad de medida.', sin_unidad;
  END IF;

  SELECT COUNT(*) INTO sin_consumo
  FROM (
    SELECT a."id" AS "aderezoId", c."id" AS "categoriaId"
    FROM "Aderezo" a CROSS JOIN "Categoria" c WHERE a."esGlobal" = true
    UNION
    SELECT ac."aderezoId", ac."categoriaId" FROM "AderezoCategoria" ac
  ) o
  WHERE NOT EXISTS (
    SELECT 1 FROM "AderezoConsumo" x
    WHERE x."aderezoId" = o."aderezoId" AND x."categoriaId" = o."categoriaId"
  );

  IF sin_consumo > 0 THEN
    RAISE EXCEPTION
      'Backfill incompleto: quedan % combinaciones aderezo-categoria sin consumo.', sin_consumo;
  END IF;

  RAISE NOTICE 'Aderezos: ninguna salsa sin unidad y ninguna combinacion ofrecida sin consumo.';
END $$;
