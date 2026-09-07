-- El horario de atencion pasa a ser POR DIA DE LA SEMANA.
--
-- QUE HABIA: dos claves sueltas en "Configuracion" — 'hora_apertura' y
-- 'hora_cierre' — que regian de lunes a domingo por igual. Un local que abre
-- 12:00 los sabados y 19:00 el resto de la semana no se podia expresar, y un
-- dia de descanso (cerrado los lunes) tampoco: la unica forma era vaciar el
-- horario, que ademas cae en el fail-open y deja el local ABIERTO siempre.
--
-- QUE HACE ESTA MIGRACION, en orden:
--   1. Crea "HorarioDia" (7 filas, una por dia, 0=Lunes ... 6=Domingo).
--   2. Backfill: las 7 filas nacen ABIERTAS y con el MISMO horario global que
--      regia hasta ahora, leido de "Configuracion". Nadie nota el cambio.
--   3. Siembra 'local_cerrado_forzado' = 'false' (el "el local no toma
--      pedidos" que anula el horario). Arranca apagado: sin esto la clave no
--      existe y el codigo la lee como false igual, pero dejarla creada hace
--      que el panel la muestre desde el minuto cero.
--
-- LO QUE NO HACE, A PROPOSITO: no borra 'hora_apertura' ni 'hora_cierre'. El
-- frontend desplegado en Vercel las sigue leyendo DIRECTO de GET /config
-- (hooks/useConfig.ts y components/menu/MenuHeader.tsx), asi que borrarlas
-- ahora dejaria el cartel del menu publico mostrando su fallback hardcodeado
-- "21:00 — 23:30". Se borran en una migracion aparte, DESPUES de que salga el
-- frontend nuevo. Es el mismo criterio en dos pasos que se uso con
-- 'stock_bajo_umbral'.
--
-- SEGURIDAD CONTRA LOS DATOS EXISTENTES
-- - Es ADITIVA PURA: una tabla nueva y una clave nueva. No altera ni borra
--   ninguna fila ni columna preexistente, asi que el codigo viejo sigue
--   funcionando entero si el deploy queda a mitad de camino (el backend viejo
--   ignora la tabla; el nuevo, si la tabla llegara vacia, cae en el fail-open
--   y deja el local abierto — nunca cerrado por error).
-- - El horario global se lee con GUARDA DE FORMATO: solo se acepta HH:MM de
--   24hs (`^([01][0-9]|2[0-3]):[0-5][0-9]$`). Si alguien lo edito a mano y
--   quedo en "", en "nueve" o en "25:00", se cae al default historico de la
--   clave (21:00 / 23:30) en vez de escribir basura en las 7 filas. Ese
--   default es el mismo que sembraba config.service.ts.
-- - Si las claves directamente no existen (base nueva, o alguien las borro),
--   el COALESCE tambien cae a 21:00 / 23:30.
-- - El INSERT de la clave nueva es ON CONFLICT DO NOTHING: idempotente, no
--   pisa un valor ya elegido si la migracion se corriera dos veces.
-- - gen_random_uuid() es nativo desde PG13, no necesita pgcrypto.
-- - Reversible sin perdida de datos que existieran antes: DROP TABLE
--   "HorarioDia" y DELETE de la clave alcanzan; el horario global sigue en su
--   lugar porque esta migracion no lo toco.

-- 1. Tabla nueva.
CREATE TABLE "HorarioDia" (
    "id"        TEXT NOT NULL,
    "dia"       INTEGER NOT NULL,
    "abierto"   BOOLEAN NOT NULL DEFAULT true,
    "desde"     VARCHAR(5) NOT NULL,
    "hasta"     VARCHAR(5) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HorarioDia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HorarioDia_dia_key" ON "HorarioDia"("dia");

-- 2. Backfill: 7 dias abiertos con el horario global que regia hasta ahora.
DO $$
DECLARE
  apertura_texto text;
  cierre_texto   text;
  apertura       text;
  cierre         text;
  formato        text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
BEGIN
  SELECT "valor" INTO apertura_texto
  FROM "Configuracion" WHERE "clave" = 'hora_apertura';

  SELECT "valor" INTO cierre_texto
  FROM "Configuracion" WHERE "clave" = 'hora_cierre';

  -- Cada uno cae por su cuenta: si solo uno esta corrupto, el otro se respeta.
  IF apertura_texto ~ formato THEN
    apertura := apertura_texto;
  ELSE
    apertura := '21:00';
  END IF;

  IF cierre_texto ~ formato THEN
    cierre := cierre_texto;
  ELSE
    cierre := '23:30';
  END IF;

  INSERT INTO "HorarioDia" ("id", "dia", "abierto", "desde", "hasta", "updatedAt")
  SELECT gen_random_uuid()::text, d, true, apertura, cierre, now()
  FROM generate_series(0, 6) AS d
  ON CONFLICT ("dia") DO NOTHING;

  RAISE NOTICE
    'HorarioDia: 7 dias creados abiertos de % a % (horario global heredado).',
    apertura, cierre;
END $$;

-- 3. El toggle "el local no toma pedidos", apagado.
INSERT INTO "Configuracion" ("id", "clave", "valor", "descripcion", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'local_cerrado_forzado',
  'false',
  'Cierre manual: si es true el local no toma pedidos, sin importar el horario',
  now(),
  now()
)
ON CONFLICT ("clave") DO NOTHING;
