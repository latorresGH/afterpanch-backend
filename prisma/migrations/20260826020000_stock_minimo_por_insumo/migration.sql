-- El stock minimo pasa a ser POR INSUMO y se elimina el umbral global.
--
-- Que habia: dos criterios conviviendo. La columna "Insumo"."stockMinimo"
-- (que el Home ya usaba para contar los insumos bajo minimo) y la clave
-- 'stock_bajo_umbral' de "Configuracion" (default '10'), que el POS usaba para
-- pintar los badges de stock bajo contra un numero unico para todo el
-- deposito. Un insumo del que se venden 60 unidades por dia y otro del que se
-- usan 2 no pueden compartir umbral, asi que gana el de la columna.
--
-- Esta migracion hace dos cosas, en este orden:
--   1. Backfill: los insumos SIN minimo propio (0 o negativo) heredan el valor
--      que el negocio tenia configurado como global, para no dejarlos con un
--      umbral peor que el que ya regia.
--   2. Borra la clave global, que a partir de aca no la lee nadie en el back.
--
-- SEGURIDAD CONTRA LOS DATOS EXISTENTES
-- - El UPDATE es idempotente y solo sube valores no configurados: no puede
--   bajarle el minimo a un insumo que ya lo tenia puesto a mano.
-- - "stockMinimo" es NOT NULL con default en el schema, asi que el IS NULL del
--   WHERE nunca deberia matchear. Se deja escrito igual: si alguna vez la
--   columna se aflojo a nullable, este backfill igual la deja consistente.
-- - Si el valor guardado en Configuracion no es un numero valido o es <= 0
--   (alguien lo edito a mano y quedo en "" o en "diez"), se cae al default
--   historico de 10 en vez de escribir basura en 47 filas.
-- - El DELETE toca UNA fila de una tabla de configuracion clave/valor. No hay
--   FKs colgando de ella.
--
-- PENDIENTE DEL LADO DEL FRONT (todavia leen la clave global):
--   - hooks/useStockDisponibilidad.ts  -> comparar contra insumo.stockMinimo
--   - app/admin/config/page.tsx        -> sacar el input del umbral global
-- Los dos tienen fallback a 10, asi que no rompen cuando la clave desaparece.

DO $$
DECLARE
  umbral_texto text;
  umbral       double precision;
  actualizados int;
BEGIN
  SELECT "valor" INTO umbral_texto
  FROM "Configuracion"
  WHERE "clave" = 'stock_bajo_umbral';

  -- Solo se acepta un numero decimal simple. Cualquier otra cosa (vacio,
  -- texto, negativo) cae al default historico de la clave.
  IF umbral_texto ~ '^[0-9]+(\.[0-9]+)?$' THEN
    umbral := umbral_texto::double precision;
  ELSE
    umbral := 10;
  END IF;

  IF umbral <= 0 THEN
    umbral := 10;
  END IF;

  UPDATE "Insumo"
  SET "stockMinimo" = umbral
  WHERE "stockMinimo" IS NULL OR "stockMinimo" <= 0;

  GET DIAGNOSTICS actualizados = ROW_COUNT;

  RAISE NOTICE
    'stockMinimo: % insumo(s) sin minimo propio heredaron el umbral global (%).',
    actualizados, umbral;
END $$;

-- El global deja de existir. El backend ya no lo siembra
-- (config.service.ts -> inicializarPorDefecto) ni lo lee en ningun lado.
DELETE FROM "Configuracion" WHERE "clave" = 'stock_bajo_umbral';
