import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  ZONA_HORARIA_NEGOCIO,
  claveFecha,
  finDelDia,
  inicioVentanaDias,
} from '../common/helpers/fecha.helper';
import {
  BAJO_MINIMO_ADEREZO_SQL,
  ESTADO_ADEREZO_SQL,
  SIN_STOCK_ADEREZO_SQL,
  cteConsumoDeAderezos,
  type EstadoAderezo,
} from './aderezos.sql';
import {
  AdminAderezosQueryDto,
  AlcanceAderezo,
  DIAS_CONSUMO_POR_DEFECTO,
  DisponibilidadAderezo,
  EstadoStockAderezo,
  OrdenAderezos,
  PAGE_SIZE_MAXIMO,
  PAGE_SIZE_POR_DEFECTO,
} from './dto/admin-aderezos-query.dto';
import { CrearAderezoDto, EditarAderezoDto } from './dto/admin-aderezo.dto';

/** Cuantas salsas entran en el bloque "reponer primero" del header. */
const TOP_SE_AGOTAN = 5;

/** Limites del historial de movimientos. Mismos numeros que Insumos y Extras. */
export const LIMITE_MOVIMIENTOS_POR_DEFECTO = 50;
export const LIMITE_MOVIMIENTOS_MAXIMO = 200;

interface Rango {
  inicio: Date;
  fin: Date;
}

/** Una fila del listado, tal como sale del `$queryRaw`. */
interface FilaAderezo {
  id: string;
  nombre: string;
  unidadMedida: string | null;
  stockActual: number;
  stockMinimo: number;
  activo: boolean;
  esGlobal: boolean;
  estado: EstadoAderezo;
  categorias: number;
  consumos: number;
  consumosFaltantes: number;
  consumido: number;
  movimientos: number;
}

/** Una fila del bloque "reponer primero". */
interface FilaAgotan {
  id: string;
  nombre: string;
  unidadMedida: string | null;
  stockActual: number;
  stockMinimo: number;
  estado: EstadoAderezo;
  consumido: number;
}

/**
 * ORDER BY por cada orden soportado.
 *
 * Se arma como SQL literal, asi que la unica entrada posible es el enum del
 * DTO (el ValidationPipe rechaza cualquier otra cosa antes de llegar aca).
 * Todos terminan en `a."id"` para que la paginacion sea estable: sin un
 * desempate unico, dos salsas con el mismo nombre pueden intercambiarse entre
 * paginas y aparecer repetidas o faltar.
 */
const ORDEN_SQL: Record<OrdenAderezos, Prisma.Sql> = {
  // Cuanto le queda EN PROPORCION a su propio minimo, igual que en Insumos y
  // Extras. Una salsa con 3 de 8 esta peor que una con 20 de 60.
  [OrdenAderezos.POR_REPONER]: Prisma.sql`
    (a."stockActual" / GREATEST(a."stockMinimo", 1)) ASC, a."nombre" ASC, a."id" ASC
  `,
  /**
   * Cuantos dias aguanta al ritmo de la ventana. Es el orden del mockup.
   *
   * `NULLIF(GREATEST(consumido, 0), 0)` deja la division en NULL cuando no
   * hubo consumo (o cuando fue neto negativo, que pasa si se cancelaron mas
   * pedidos de los que se sirvieron), y el `NULLS LAST` manda esas salsas al
   * final: no aguantan infinito, no hay con que estimarlas. Sin el NULLS LAST
   * encabezarian el ranking de urgencia para siempre.
   */
  [OrdenAderezos.AGUANTE]: Prisma.sql`
    (a."stockActual" / NULLIF(GREATEST(COALESCE(c.consumido, 0), 0), 0)) ASC NULLS LAST,
    a."nombre" ASC, a."id" ASC
  `,
  [OrdenAderezos.CONSUMO]: Prisma.sql`
    COALESCE(c.consumido, 0) DESC, a."nombre" ASC, a."id" ASC
  `,
  [OrdenAderezos.STOCK_DESC]: Prisma.sql`a."stockActual" DESC, a."nombre" ASC, a."id" ASC`,
  [OrdenAderezos.STOCK_ASC]: Prisma.sql`a."stockActual" ASC, a."nombre" ASC, a."id" ASC`,
  [OrdenAderezos.ALFABETICO]: Prisma.sql`a."nombre" ASC, a."id" ASC`,
};

/**
 * Toda la pantalla de Salsas/Aderezos del panel en una sola request.
 *
 * Mismo criterio que el resto del rework: el front vive en Vercel y la API en
 * Hetzner, cada fetch server-side es un round trip, y ningun total se calcula
 * trayendo filas. La busqueda, los filtros, el orden (incluido "aguante", que
 * ordena por un agregado sobre el ledger de movimientos) y la paginacion los
 * resuelve Postgres.
 *
 * ⚠️ LAS SALSAS NO TIENEN PRECIO. Son siempre gratis, por decision de
 * producto. Esta clase no lee ni escribe "AderezoPrecio" (0 filas, marcada
 * para deprecar) y no expone ningun campo de precio en ninguna respuesta.
 *
 * QUE NO HACE ESTA CLASE: no toca la logica de descuento de stock. El consumo
 * por categoria (`AderezoConsumo`) se LEE y se EDITA desde aca, pero quien lo
 * aplica al vender sigue siendo `PedidosService.getAderezoConsumo`, sin
 * cambios. Lo unico que cambia es que ahora ese valor no puede faltar, asi que
 * su fallback de 1 deja de alcanzarse por configuracion incompleta.
 */
@Injectable()
export class AdminAderezosService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------- listado

  async listar(query: AdminAderezosQueryDto, ahora: Date = new Date()) {
    const page = query.page ?? 1;
    const pageSize = Math.min(
      query.pageSize ?? PAGE_SIZE_POR_DEFECTO,
      PAGE_SIZE_MAXIMO,
    );
    const orden = query.orden ?? OrdenAderezos.POR_REPONER;
    const estado = query.estado ?? EstadoStockAderezo.TODOS;
    const disponibilidad =
      query.disponibilidad ?? DisponibilidadAderezo.ACTIVOS;
    const alcance = query.alcance ?? AlcanceAderezo.TODOS;
    const dias = query.dias ?? DIAS_CONSUMO_POR_DEFECTO;
    const offset = (page - 1) * pageSize;

    const ventana: Rango = {
      inicio: inicioVentanaDias(dias, ahora),
      fin: finDelDia(ahora),
    };

    const where = this.armarWhere(query, estado, disponibilidad, alcance);
    const consumo = cteConsumoDeAderezos(ventana.inicio, ventana.fin);

    const [filas, total, conteos, consumoTotal, agotan, categoriasDe] =
      await Promise.all([
        this.paginaDeAderezos(consumo, where, orden, pageSize, offset),
        this.contarFiltrados(where),
        this.conteosDelHeader(),
        this.consumoDelHeader(ventana),
        this.seAgotanPrimero(consumo),
        this.categoriasPorAderezo(consumo, where, orden, pageSize, offset),
      ]);

    const activos = conteos.activos;

    return {
      stats: {
        ...conteos,
        /**
         * La "salud del stock" del header: que porcentaje de las salsas en la
         * carta tiene stock suficiente. Sobre ACTIVAS, no sobre el total: una
         * salsa pausada no esta ni bien ni mal, esta fuera de juego.
         */
        pctOk: this.porcentaje(conteos.ok, activos),
        consumo: {
          ventanaDias: dias,
          total: this.redondear(consumoTotal.consumido),
          diario: this.redondear(consumoTotal.consumido / dias),
          descontado: this.redondear(consumoTotal.descontado),
          repuesto: this.redondear(consumoTotal.repuesto),
          /** Cuantas salsas se movieron en la ventana. */
          salsasEnMovimiento: consumoTotal.salsas,
        },
      },

      /**
       * "Reponer primero": las que menos aguantan al ritmo de la ventana.
       *
       * Va aparte de `items` porque NO es la primera pagina del listado: es un
       * ranking sobre la carta entera que cruza stock con consumo, y por eso no
       * se puede derivar de `items` en el cliente sin traerlas todas.
       */
      seAgotan: agotan.map((fila) => this.componerAgotan(fila, dias)),

      items: filas.map((fila) =>
        this.componerItem(fila, dias, categoriasDe.get(fila.id) ?? []),
      ),

      paginacion: {
        page,
        pageSize,
        total,
        totalPaginas: Math.max(1, Math.ceil(total / pageSize)),
      },

      filtros: {
        q: query.q?.trim() || null,
        estado,
        disponibilidad,
        alcance,
        categoriaId: query.categoriaId ?? null,
        orden,
      },

      /**
       * Ventana sobre la que se midio el consumo de `items`, de `seAgotan` y
       * del header. No afecta al resto de los numeros: el stock y los conteos
       * por estado son de ahora, no del periodo.
       */
      ventana: {
        dias,
        desde: claveFecha(ventana.inicio),
        hasta: claveFecha(ventana.fin),
        zonaHoraria: ZONA_HORARIA_NEGOCIO,
      },
    };
  }

  /** Filtros del listado. Todos los valores viajan parametrizados. */
  private armarWhere(
    query: AdminAderezosQueryDto,
    estado: EstadoStockAderezo,
    disponibilidad: DisponibilidadAderezo,
    alcance: AlcanceAderezo,
  ): Prisma.Sql {
    const condiciones: Prisma.Sql[] = [];

    if (disponibilidad === DisponibilidadAderezo.ACTIVOS) {
      condiciones.push(Prisma.sql`a."activo" = true`);
    } else if (disponibilidad === DisponibilidadAderezo.PAUSADOS) {
      condiciones.push(Prisma.sql`a."activo" = false`);
    }

    if (estado === EstadoStockAderezo.SIN_STOCK) {
      condiciones.push(Prisma.sql`a."stockActual" <= 0`);
    } else if (estado === EstadoStockAderezo.BAJO) {
      condiciones.push(
        Prisma.sql`a."stockActual" > 0 AND a."stockActual" < a."stockMinimo"`,
      );
    } else if (estado === EstadoStockAderezo.POR_REPONER) {
      condiciones.push(Prisma.sql`a."stockActual" < a."stockMinimo"`);
    } else if (estado === EstadoStockAderezo.OK) {
      condiciones.push(
        Prisma.sql`a."stockActual" > 0 AND a."stockActual" >= a."stockMinimo"`,
      );
    }

    // El alcance es "donde se ofrece": global, acotada, o en ningun lado.
    if (alcance === AlcanceAderezo.GLOBALES) {
      condiciones.push(Prisma.sql`a."esGlobal" = true`);
    } else if (alcance === AlcanceAderezo.POR_CATEGORIA) {
      condiciones.push(Prisma.sql`
        a."esGlobal" = false
        AND EXISTS (SELECT 1 FROM "AderezoCategoria" ac WHERE ac."aderezoId" = a."id")
      `);
    } else if (alcance === AlcanceAderezo.SIN_ALCANCE) {
      condiciones.push(Prisma.sql`
        a."esGlobal" = false
        AND NOT EXISTS (SELECT 1 FROM "AderezoCategoria" ac WHERE ac."aderezoId" = a."id")
      `);
    }

    // "Las que se ofrecen en esta categoria": una global se ofrece en todas.
    if (query.categoriaId) {
      condiciones.push(Prisma.sql`(
        a."esGlobal" = true
        OR EXISTS (
          SELECT 1 FROM "AderezoCategoria" ac
          WHERE ac."aderezoId" = a."id" AND ac."categoriaId" = ${query.categoriaId}
        )
      )`);
    }

    const texto = query.q?.trim();
    if (texto) {
      // Los comodines del ILIKE se escapan: si alguien busca "50%" tiene que
      // buscar ese texto, no "50 seguido de cualquier cosa".
      const patron = `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      condiciones.push(Prisma.sql`a."nombre" ILIKE ${patron}`);
    }

    if (condiciones.length === 0) return Prisma.empty;
    return Prisma.sql`WHERE ${Prisma.join(condiciones, ' AND ')}`;
  }

  /** La pagina pedida, ya ordenada, derivada y recortada por Postgres. */
  private paginaDeAderezos(
    consumo: Prisma.Sql,
    where: Prisma.Sql,
    orden: OrdenAderezos,
    pageSize: number,
    offset: number,
  ) {
    return this.prisma.$queryRaw<FilaAderezo[]>`
      WITH consumo AS (${consumo})
      SELECT a."id",
             a."nombre",
             a."unidadMedida",
             a."stockActual"::float8         AS "stockActual",
             a."stockMinimo"::float8         AS "stockMinimo",
             a."activo",
             a."esGlobal",
             (${ESTADO_ADEREZO_SQL})         AS "estado",
             (SELECT COUNT(*) FROM "AderezoCategoria" ac WHERE ac."aderezoId" = a."id")::int AS "categorias",
             (SELECT COUNT(*) FROM "AderezoConsumo"  x  WHERE x."aderezoId"  = a."id")::int AS "consumos",
             (
               -- En cuantas categorias donde SE OFRECE le falta el consumo, o
               -- sea en cuantas descuenta 1 a ciegas. Una global se ofrece en
               -- todas, asi que le falta una fila por cada categoria sin cargar.
               CASE
                 WHEN a."esGlobal" THEN (
                   SELECT COUNT(*) FROM "Categoria" c
                   WHERE NOT EXISTS (
                     SELECT 1 FROM "AderezoConsumo" x
                     WHERE x."aderezoId" = a."id" AND x."categoriaId" = c."id")
                 )
                 ELSE (
                   SELECT COUNT(*) FROM "AderezoCategoria" ac
                   WHERE ac."aderezoId" = a."id"
                     AND NOT EXISTS (
                       SELECT 1 FROM "AderezoConsumo" x
                       WHERE x."aderezoId" = a."id" AND x."categoriaId" = ac."categoriaId")
                 )
               END
             )::int                          AS "consumosFaltantes",
             COALESCE(c.consumido, 0)::float8 AS "consumido",
             COALESCE(c.movimientos, 0)::int  AS "movimientos"
      FROM "Aderezo" a
      LEFT JOIN consumo c ON c.id = a."id"
      ${where}
      ORDER BY ${ORDEN_SQL[orden]}
      LIMIT ${pageSize} OFFSET ${offset}
    `;
  }

  /**
   * Las categorias de las salsas de la pagina, en una query aparte.
   *
   * Va separada y no como agregado de la anterior porque un JOIN contra
   * "AderezoCategoria" multiplicaria las filas y romperia el LIMIT: la pagina
   * dejaria de tener `pageSize` salsas. Repite el mismo WHERE/ORDER/LIMIT para
   * traer exactamente los mismos ids.
   */
  private async categoriasPorAderezo(
    consumo: Prisma.Sql,
    where: Prisma.Sql,
    orden: OrdenAderezos,
    pageSize: number,
    offset: number,
  ): Promise<Map<string, Array<{ id: string; nombre: string }>>> {
    const filas = await this.prisma.$queryRaw<
      Array<{ aderezoId: string; id: string; nombre: string }>
    >`
      WITH consumo AS (${consumo}),
      pagina AS (
        SELECT a."id"
        FROM "Aderezo" a
        LEFT JOIN consumo c ON c.id = a."id"
        ${where}
        ORDER BY ${ORDEN_SQL[orden]}
        LIMIT ${pageSize} OFFSET ${offset}
      )
      SELECT ac."aderezoId", cat."id", cat."nombre"
      FROM "AderezoCategoria" ac
      JOIN pagina p       ON p."id" = ac."aderezoId"
      JOIN "Categoria" cat ON cat."id" = ac."categoriaId"
      ORDER BY cat."nombre" ASC
    `;

    const mapa = new Map<string, Array<{ id: string; nombre: string }>>();
    for (const fila of filas) {
      const lista = mapa.get(fila.aderezoId) ?? [];
      lista.push({ id: fila.id, nombre: fila.nombre });
      mapa.set(fila.aderezoId, lista);
    }
    return mapa;
  }

  /**
   * Total de la paginacion. Va en una query aparte y no como `COUNT(*) OVER ()`
   * de la anterior porque esa devuelve cero filas cuando la pagina queda vacia
   * (busqueda sin resultados, `page` mas alla del final) y ahi el total se
   * perderia justo cuando el front lo necesita para volver a la pagina 1.
   */
  private async contarFiltrados(where: Prisma.Sql): Promise<number> {
    const filas = await this.prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS total
      FROM "Aderezo" a
      ${where}
    `;
    return filas[0]?.total ?? 0;
  }

  /**
   * Los conteos del header. De la carta ENTERA, no de lo filtrado: describen el
   * estado del negocio, no el de la busqueda.
   *
   * Los conteos por estado miran solo activas (una salsa pausada no esta "bajo
   * minimo", esta fuera de juego), y por eso ok + bajo + sinStock da
   * exactamente `activos`.
   *
   * `sinConsumoConfigurado` es el numero que justifica esta seccion: cuantas
   * salsas se ofrecen en algun lado pero no tienen cargado cuanto consumen, y
   * por lo tanto descuentan 1 por defecto al venderse (ver el WARN de
   * `PedidosService.getAderezoConsumo`). Una global cuenta como incompleta si
   * le falta la fila de CUALQUIER categoria, porque se ofrece en todas.
   */
  private async conteosDelHeader() {
    const filas = await this.prisma.$queryRaw<
      Array<{
        total: number;
        activos: number;
        pausados: number;
        ok: number;
        bajo: number;
        sinStock: number;
        porReponer: number;
        globales: number;
        sinAlcance: number;
        sinConsumoConfigurado: number;
        sinUnidad: number;
      }>
    >`
      WITH cats AS (SELECT COUNT(*)::int AS n FROM "Categoria")
      SELECT
        COUNT(*)::int                                                  AS "total",
        COUNT(*) FILTER (WHERE a."activo")::int                        AS "activos",
        COUNT(*) FILTER (WHERE NOT a."activo")::int                    AS "pausados",
        COUNT(*) FILTER (
          WHERE a."activo" AND a."stockActual" > 0
            AND a."stockActual" >= a."stockMinimo")::int               AS "ok",
        COUNT(*) FILTER (
          WHERE a."activo" AND a."stockActual" > 0
            AND a."stockActual" < a."stockMinimo")::int                AS "bajo",
        COUNT(*) FILTER (WHERE ${SIN_STOCK_ADEREZO_SQL})::int          AS "sinStock",
        COUNT(*) FILTER (WHERE ${BAJO_MINIMO_ADEREZO_SQL})::int        AS "porReponer",
        COUNT(*) FILTER (WHERE a."activo" AND a."esGlobal")::int       AS "globales",
        COUNT(*) FILTER (
          WHERE a."activo" AND NOT a."esGlobal"
            AND NOT EXISTS (
              SELECT 1 FROM "AderezoCategoria" ac WHERE ac."aderezoId" = a."id"))::int
                                                                       AS "sinAlcance",
        COUNT(*) FILTER (
          WHERE a."activo" AND (
            CASE
              -- Global: necesita una fila por cada categoria.
              WHEN a."esGlobal" THEN
                (SELECT COUNT(*) FROM "AderezoConsumo" x
                  JOIN "Categoria" c ON c."id" = x."categoriaId"
                 WHERE x."aderezoId" = a."id") < (SELECT n FROM cats)
              -- Acotada: una por cada categoria donde se ofrece.
              ELSE EXISTS (
                SELECT 1 FROM "AderezoCategoria" ac
                WHERE ac."aderezoId" = a."id"
                  AND NOT EXISTS (
                    SELECT 1 FROM "AderezoConsumo" x
                    WHERE x."aderezoId" = a."id"
                      AND x."categoriaId" = ac."categoriaId"))
            END
          ))::int                                                      AS "sinConsumoConfigurado",
        -- Deberia ser 0 despues del backfill de 20260831000000. Se expone para
        -- que la pantalla pueda avisar si vuelve a aparecer una.
        COUNT(*) FILTER (
          WHERE a."unidadMedida" IS NULL OR btrim(a."unidadMedida") = '')::int
                                                                       AS "sinUnidad"
      FROM "Aderezo" a
    `;

    const c = filas[0];
    return {
      total: c?.total ?? 0,
      activos: c?.activos ?? 0,
      pausados: c?.pausados ?? 0,
      ok: c?.ok ?? 0,
      bajo: c?.bajo ?? 0,
      sinStock: c?.sinStock ?? 0,
      /** bajo + sinStock. */
      porReponer: c?.porReponer ?? 0,
      globales: c?.globales ?? 0,
      /** Activas que no se ofrecen en ningun lado: existen pero nadie las ve. */
      sinAlcance: c?.sinAlcance ?? 0,
      /** Activas que descuentan 1 por defecto en al menos una categoria. */
      sinConsumoConfigurado: c?.sinConsumoConfigurado ?? 0,
      /** Salsas sin unidad de medida. Post-backfill tiene que ser 0. */
      sinUnidad: c?.sinUnidad ?? 0,
    };
  }

  /**
   * El consumo del periodo, agregado sobre el ledger.
   *
   * Mismo criterio que `cteConsumoDeAderezos`: neto, y sin contar los
   * AJUSTE_MANUAL. Se separan `descontado` y `repuesto` para que la pantalla
   * pueda explicar de donde sale el neto.
   */
  private async consumoDelHeader(ventana: Rango) {
    const filas = await this.prisma.$queryRaw<
      Array<{
        consumido: number;
        descontado: number;
        repuesto: number;
        salsas: number;
      }>
    >`
      SELECT
        COALESCE(SUM(-"cantidad"), 0)::float8                          AS "consumido",
        COALESCE(SUM(-"cantidad") FILTER (
          WHERE "tipo" = 'DESCUENTO_PEDIDO'), 0)::float8               AS "descontado",
        COALESCE(SUM("cantidad") FILTER (
          WHERE "tipo" = 'REPOSICION'), 0)::float8                     AS "repuesto",
        COUNT(DISTINCT "aderezoId")::int                               AS "salsas"
      FROM "StockMovimiento"
      WHERE "aderezoId" IS NOT NULL
        AND "tipo" IN ('DESCUENTO_PEDIDO', 'REPOSICION')
        AND "createdAt" >= ${ventana.inicio}
        AND "createdAt" <= ${ventana.fin}
    `;

    const f = filas[0];
    return {
      consumido: Number(f?.consumido ?? 0),
      descontado: Number(f?.descontado ?? 0),
      repuesto: Number(f?.repuesto ?? 0),
      salsas: f?.salsas ?? 0,
    };
  }

  /**
   * Las que menos aguantan: el bloque "reponer primero" del header.
   *
   * Solo activas y solo con consumo > 0: una salsa que no se movio no tiene
   * "dias de aguante", y encabezaria el ranking para siempre. El orden es por
   * dias (stock / consumo) y lo resuelve SQL, para no traer la carta entera a
   * Node para quedarse con cinco.
   */
  private seAgotanPrimero(consumo: Prisma.Sql) {
    return this.prisma.$queryRaw<FilaAgotan[]>`
      WITH consumo AS (${consumo})
      SELECT a."id",
             a."nombre",
             a."unidadMedida",
             a."stockActual"::float8 AS "stockActual",
             a."stockMinimo"::float8 AS "stockMinimo",
             (${ESTADO_ADEREZO_SQL}) AS "estado",
             c.consumido::float8     AS "consumido"
      FROM "Aderezo" a
      JOIN consumo c ON c.id = a."id"
      WHERE a."activo" AND c.consumido > 0
      ORDER BY (a."stockActual" / c.consumido) ASC, a."nombre" ASC, a."id" ASC
      LIMIT ${TOP_SE_AGOTAN}
    `;
  }

  // ------------------------------------------------------------- detalle

  /**
   * La ficha completa, con TODO lo editable.
   *
   * Devuelve una fila por cada categoria (no solo por las que la salsa tiene
   * configuradas) con su consumo, y con las banderas que dicen si ese valor
   * esta cargado o si sale de un default. Es la unica forma de que el form
   * pueda mostrar "este consumo no esta configurado y por eso descuenta 1".
   *
   * SIN PRECIO: las salsas son gratis y no hay nada que cobrar por categoria.
   */
  async detalle(id: string) {
    const aderezo = await this.prisma.aderezo.findUnique({
      where: { id },
      include: {
        categoriasAplica: { select: { categoriaId: true } },
        consumosPorCategoria: {
          select: { categoriaId: true, cantidadConsumo: true },
        },
      },
    });

    if (!aderezo) throw new NotFoundException('Aderezo no encontrado');

    /**
     * TODAS las categorias, no solo las activas.
     *
     * El consumo es obligatorio donde la salsa se ofrece, y esa validacion
     * corre sobre todas las categorias (ver `validarConsumoCompleto`). Si la
     * ficha devolviera solo las activas, desactivar una categoria dejaria a la
     * salsa INEDITABLE: el form no tendria donde cargar el consumo que la
     * validacion le va a exigir. Cada fila trae `activa` para que la pantalla
     * pueda ordenarlas o atenuarlas.
     */
    const categorias = await this.prisma.categoria.findMany({
      select: {
        id: true,
        nombre: true,
        activo: true,
        sinExtrasNiAderezos: true,
      },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    });

    const aplicaEn = new Set(
      aderezo.categoriasAplica.map((c) => c.categoriaId),
    );
    const consumoDe = new Map(
      aderezo.consumosPorCategoria.map((c) => [
        c.categoriaId,
        Number(c.cantidadConsumo),
      ]),
    );

    const filas = categorias.map((categoria) => {
      const aplica = aderezo.esGlobal || aplicaEn.has(categoria.id);
      const consumo = consumoDe.get(categoria.id) ?? null;

      return {
        categoriaId: categoria.id,
        nombre: categoria.nombre,
        /** La categoria esta dada de alta. Una inactiva igual se puede editar. */
        activa: categoria.activo,
        /** Si la salsa se ofrece en esta categoria hoy. */
        aplica,
        /**
         * La categoria no admite aderezos: aunque la salsa sea global, aca no
         * aparece (`Categoria.sinExtrasNiAderezos` anula incluso las globales).
         */
        admiteAderezos: !categoria.sinExtrasNiAderezos,

        consumo,
        /**
         * El que se descuenta de verdad. El 1 NO es una decision de negocio:
         * es el fallback de `PedidosService.getAderezoConsumo` cuando no hay
         * fila, y por eso `consumoEnDefault` existe.
         */
        consumoEfectivo: consumo ?? 1,
        consumoEnDefault: consumo === null,
        /** Se ofrece aca Y no tiene consumo cargado: descuenta 1 a ciegas. */
        consumoFaltante: aplica && consumo === null,
      };
    });

    return {
      id: aderezo.id,
      nombre: aderezo.nombre,
      unidadMedida: aderezo.unidadMedida,
      stockActual: Number(aderezo.stockActual),
      stockMinimo: Number(aderezo.stockMinimo),
      activo: aderezo.activo,
      esGlobal: aderezo.esGlobal,
      estado: this.estadoDe(aderezo),

      /**
       * Explicito y no por omision: las salsas son SIEMPRE GRATIS. El front no
       * tiene que inferirlo de que no venga un campo `precio`.
       */
      gratis: true as const,

      alcance: {
        esGlobal: aderezo.esGlobal,
        categoriaIds: [...aplicaEn],
        /** En cuantas categorias se ofrece hoy. */
        categoriasAlcanzadas: filas.filter((f) => f.aplica).length,
        /** Ni global ni con categorias: no se ofrece en ningun lado. */
        sinAlcance: !aderezo.esGlobal && aplicaEn.size === 0,
      },

      /** Una fila por categoria, con el consumo editable. */
      categorias: filas,

      resumen: {
        consumosConfigurados: filas.filter((f) => !f.consumoEnDefault).length,
        /** Cuantas categorias donde SE OFRECE no tienen consumo cargado. */
        consumosFaltantes: filas.filter((f) => f.consumoFaltante).length,
      },
    };
  }

  // ------------------------------------------------------------- escritura

  async crear(dto: CrearAderezoDto) {
    const nombre = dto.nombre.trim();
    await this.rechazarNombreRepetido(nombre);
    await this.validarReferencias(dto);
    await this.validarConsumoCompleto(dto);

    const creado = await this.prisma.$transaction(async (tx) => {
      const aderezo = await tx.aderezo.create({
        data: {
          nombre,
          unidadMedida: dto.unidadMedida,
          /**
           * 0 y no 999. El 999 era un default hardcodeado —en el modal del
           * front y como fallback del service viejo— que hacia que toda salsa
           * naciera "con stock de sobra" sin que nadie lo hubiera contado. La
           * pantalla nueva pide el stock real en el alta.
           */
          stockActual: dto.stockActual ?? 0,
          stockMinimo: dto.stockMinimo,
          activo: dto.activo ?? true,
          esGlobal: dto.esGlobal ?? false,
        },
      });

      await this.reemplazarConfiguracion(tx, aderezo.id, dto);
      return aderezo;
    });

    return this.detalle(creado.id);
  }

  /**
   * Edicion. Los dos bloques de configuracion son reemplazo completo cuando
   * vienen y quedan intactos cuando no.
   *
   * Todo va en una transaccion: una salsa que quede con las categorias nuevas y
   * los consumos viejos es exactamente el estado desalineado que esta seccion
   * viene a arreglar.
   *
   * ⚠️ `stockActual` por PATCH escribe un valor ABSOLUTO y deja el movimiento
   * de auditoria, pero tiene una carrera conocida: lee, calcula y escribe. Para
   * los ajustes del dia a dia estan `/aderezos/:id/sumar` y
   * `/aderezos/:id/descontar`, que hacen increment/decrement atomico. Ver la
   * nota de `StockMovAderezoDto`.
   */
  async editar(id: string, dto: EditarAderezoDto) {
    const actual = await this.prisma.aderezo.findUnique({
      where: { id },
      select: {
        stockActual: true,
        esGlobal: true,
        categoriasAplica: { select: { categoriaId: true } },
        consumosPorCategoria: { select: { categoriaId: true } },
      },
    });
    if (!actual) throw new NotFoundException('Aderezo no encontrado');

    const nombre = dto.nombre?.trim();
    if (nombre !== undefined) {
      await this.rechazarNombreRepetido(nombre, id);
    }
    await this.validarReferencias(dto);
    await this.validarConsumoCompleto(dto, {
      esGlobal: actual.esGlobal,
      categoriaIds: actual.categoriasAplica.map((c) => c.categoriaId),
      consumoIds: actual.consumosPorCategoria.map((c) => c.categoriaId),
    });

    const stockAntes = Number(actual.stockActual);

    await this.prisma.$transaction(async (tx) => {
      await tx.aderezo.update({
        where: { id },
        data: {
          nombre,
          unidadMedida: dto.unidadMedida,
          stockActual: dto.stockActual,
          stockMinimo: dto.stockMinimo,
          activo: dto.activo,
          esGlobal: dto.esGlobal,
        },
      });

      // Un cambio de stock desde la ficha deja rastro, igual que un ajuste
      // manual: sin esto el historial mostraria saltos sin explicacion.
      if (dto.stockActual !== undefined && dto.stockActual !== stockAntes) {
        await tx.stockMovimiento.create({
          data: {
            aderezoId: id,
            tipo: 'AJUSTE_MANUAL',
            cantidad: dto.stockActual - stockAntes,
            stockAntes,
            stockDespues: dto.stockActual,
            motivo: `Stock ajustado de ${stockAntes} a ${dto.stockActual} desde la ficha`,
          },
        });
      }

      await this.reemplazarConfiguracion(tx, id, dto);
    });

    return this.detalle(id);
  }

  async setActivo(id: string, activo: boolean) {
    await this.ensureExists(id);
    await this.prisma.aderezo.update({
      where: { id },
      data: { activo: Boolean(activo) },
    });
    return this.detalle(id);
  }

  /**
   * Borrado real, con el mismo guard que Productos y Extras: si ya se uso en un
   * pedido, no se borra.
   *
   * ⚠️ ACA EL GUARD NO ES SOLO UNA CORTESIA. `Aderezo` tiene una relacion
   * many-to-many REAL con `PedidoDetalle` (tabla implicita
   * `_AderezoToPedidoDetalle`), y sus dos foreign keys son ON DELETE CASCADE.
   * O sea: sin este chequeo, borrar una salsa vendida NO tira error — se lleva
   * puestas en silencio las filas del join y los pedidos historicos pierden
   * para siempre que llevaban esa salsa. Encima `StockMovimiento.aderezoId` es
   * ON DELETE SET NULL, asi que sus movimientos sobreviven como filas huerfanas
   * sin dueño, invisibles para todos los historiales.
   */
  async eliminar(id: string) {
    await this.ensureExists(id);

    const usado = await this.prisma.pedidoDetalle.count({
      where: { aderezos: { some: { id } } },
      take: 1,
    });

    if (usado > 0) {
      throw new BadRequestException(
        'No se puede eliminar una salsa que ya se uso en pedidos: se perderia ' +
          'de que estaban hechos esos pedidos. Pausala (activo=false) para ' +
          'sacarla de la carta.',
      );
    }

    /**
     * Nunca se uso: se borra de verdad, con toda su configuracion.
     *
     * Los movimientos de stock se borran junto con la salsa y NO bloquean el
     * borrado. El criterio es el de Productos y Extras —lo unico que impide
     * eliminar es haber sido usado en pedidos— y aca eso ya quedo descartado.
     * Se borran en vez de dejarse porque el FK es ON DELETE SET NULL:
     * sobrevivirian como filas con `aderezoId` en null, invisibles para todos
     * los historiales y sin forma de saber de quien eran.
     *
     * "AderezoCategoria" y "AderezoConsumo" son ON DELETE CASCADE, pero se
     * borran explicitamente igual: que la limpieza este escrita es lo que hace
     * que se pueda leer que no queda nada colgando.
     */
    await this.prisma.$transaction(async (tx) => {
      await tx.stockMovimiento.deleteMany({ where: { aderezoId: id } });
      await tx.aderezoConsumo.deleteMany({ where: { aderezoId: id } });
      await tx.aderezoCategoria.deleteMany({ where: { aderezoId: id } });
      await tx.aderezo.delete({ where: { id } });
    });

    return { ok: true, id };
  }

  // ------------------------------------------------------------- historial

  /**
   * Historial de movimientos de stock de una salsa.
   *
   * El dato EXISTE: `StockMovimiento` tiene `aderezoId` desde la migracion
   * 20260511003757. Lo escriben el descuento por pedido, la reposicion al
   * cancelar y los ajustes manuales.
   *
   * `limit` esta CLAMPEADO, que es lo que le faltaba al endpoint viejo
   * (`/aderezos/:id/movimientos` hacia `parseInt(limit)` sin techo, asi que
   * `?limit=999999` se traia la tabla entera; y un `?limit=abc` daba NaN, que
   * Prisma rechaza con un 500).
   */
  async historial(id: string, limitPedido?: number) {
    const aderezo = await this.prisma.aderezo.findUnique({
      where: { id },
      select: {
        id: true,
        nombre: true,
        unidadMedida: true,
        stockActual: true,
        stockMinimo: true,
        activo: true,
      },
    });
    if (!aderezo) throw new NotFoundException('Aderezo no encontrado');

    const take = Math.min(
      Math.max(limitPedido ?? LIMITE_MOVIMIENTOS_POR_DEFECTO, 1),
      LIMITE_MOVIMIENTOS_MAXIMO,
    );

    const [movimientos, total] = await Promise.all([
      this.prisma.stockMovimiento.findMany({
        where: { aderezoId: id },
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          id: true,
          tipo: true,
          cantidad: true,
          stockAntes: true,
          stockDespues: true,
          motivo: true,
          pedidoId: true,
          createdAt: true,
        },
      }),
      this.prisma.stockMovimiento.count({ where: { aderezoId: id } }),
    ]);

    return {
      aderezo: {
        id: aderezo.id,
        nombre: aderezo.nombre,
        unidadMedida: aderezo.unidadMedida,
        stockActual: Number(aderezo.stockActual),
        stockMinimo: Number(aderezo.stockMinimo),
        activo: aderezo.activo,
        estado: this.estadoDe(aderezo),
      },
      movimientos: movimientos.map((m) => ({
        ...m,
        cantidad: Number(m.cantidad),
        stockAntes: Number(m.stockAntes),
        stockDespues: Number(m.stockDespues),
      })),
      /** Cuantos hay en total: dice si `limit` recorto la lista. */
      total,
      limit: take,
    };
  }

  // ------------------------------------------------------------- helpers

  /**
   * Reemplaza los dos bloques de configuracion.
   *
   * Solo toca el bloque que vino en el body: `undefined` es "no lo toques" y
   * `[]` es "borralos todos". Se hace con deleteMany + createMany en vez de
   * upsert fila por fila porque el set completo es el que manda: un upsert
   * dejaria vivas las filas que el usuario saco del form.
   */
  private async reemplazarConfiguracion(
    tx: Prisma.TransactionClient,
    aderezoId: string,
    dto: CrearAderezoDto | EditarAderezoDto,
  ) {
    if (dto.categoriaIds !== undefined) {
      await tx.aderezoCategoria.deleteMany({ where: { aderezoId } });
      if (dto.categoriaIds.length > 0) {
        await tx.aderezoCategoria.createMany({
          data: [...new Set(dto.categoriaIds)].map((categoriaId) => ({
            aderezoId,
            categoriaId,
          })),
          skipDuplicates: true,
        });
      }
    }

    if (dto.consumos !== undefined) {
      await tx.aderezoConsumo.deleteMany({ where: { aderezoId } });
      if (dto.consumos.length > 0) {
        await tx.aderezoConsumo.createMany({
          data: dto.consumos.map((c) => ({
            aderezoId,
            categoriaId: c.categoriaId,
            cantidadConsumo: c.cantidadConsumo,
          })),
          skipDuplicates: true,
        });
      }
    }
  }

  /**
   * REGLA DURA: donde la salsa se ofrece, tiene que estar cargado cuanto
   * consume.
   *
   * Es la que cierra de raiz el agujero del default. `getAderezoConsumo` de
   * PedidosService descuenta 1 cuando no encuentra la fila de
   * (aderezo, categoria); con esta validacion esa fila no puede faltar, asi que
   * el fallback deja de alcanzarse por configuracion incompleta.
   *
   * Se valida sobre el ESTADO FINAL, no sobre el body: un PATCH que solo cambia
   * el nombre no puede fallar porque no mando consumos. Para cada uno de los
   * bloques, lo que manda es el valor entrante si vino, y el que ya estaba si
   * no.
   *
   * "Donde se ofrece" son TODAS las categorias cuando `esGlobal` es true —no
   * las que tenga en `AderezoCategoria`, que una global ignora— y las de
   * `categoriaIds` cuando no lo es. Sin filtrar por `Categoria.activo`: el
   * descuento al vender busca por el `categoriaId` del producto sin mirar si la
   * categoria esta activa, asi que una inactiva con productos igual caeria al
   * default.
   */
  private async validarConsumoCompleto(
    dto: CrearAderezoDto | EditarAderezoDto,
    actual?: {
      esGlobal: boolean;
      categoriaIds: string[];
      consumoIds: string[];
    },
  ) {
    const esGlobal = dto.esGlobal ?? actual?.esGlobal ?? false;

    const categoriaIds =
      dto.categoriaIds ?? actual?.categoriaIds ?? ([] as string[]);

    /**
     * Un consumo en 0 no cuenta como cargado.
     *
     * El `@Min(0.0001)` del DTO ya lo rechaza por HTTP, pero el service esta
     * exportado y el invariante no puede depender de que quien llame haya
     * pasado por el ValidationPipe: un 0 que se colara contaria como
     * "configurado" y dejaria pasar exactamente el caso que la regla prohibe.
     */
    if (dto.consumos !== undefined) {
      const invalidos = dto.consumos.filter((c) => !(c.cantidadConsumo > 0));
      if (invalidos.length > 0) {
        throw new BadRequestException(
          'El consumo por categoria tiene que ser mayor a 0: un consumo en 0 ' +
            'es indistinguible de no tenerlo configurado.',
        );
      }
    }

    const conConsumo = new Set(
      dto.consumos !== undefined
        ? dto.consumos.map((c) => c.categoriaId)
        : (actual?.consumoIds ?? []),
    );

    const categorias = await this.prisma.categoria.findMany({
      select: { id: true, nombre: true },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    });

    const ofrecidasEn = esGlobal
      ? categorias
      : categorias.filter((c) => categoriaIds.includes(c.id));

    const faltantes = ofrecidasEn.filter((c) => !conConsumo.has(c.id));
    if (faltantes.length === 0) return;

    // Se nombran las que faltan, acotado: con una global sobre muchas
    // categorias la lista entera seria ilegible.
    const nombres = faltantes.slice(0, 5).map((c) => c.nombre);
    const resto =
      faltantes.length > nombres.length
        ? ` y ${faltantes.length - nombres.length} mas`
        : '';

    throw new BadRequestException(
      esGlobal
        ? `Esta salsa es global (se ofrece en toda la carta), asi que necesita el consumo cargado en TODAS las categorias. Falta en: ${nombres.join(', ')}${resto}.`
        : `No se puede ofrecer una salsa en una categoria sin decir cuanto descuenta. Falta el consumo en: ${nombres.join(', ')}${resto}.`,
    );
  }

  /**
   * Que los ids que vienen en el body existan de verdad.
   *
   * Sin esto, un `categoriaId` inexistente sale como P2003 (violacion de FK) y
   * el filtro global lo convierte en un 500 que no le dice nada a nadie.
   */
  private async validarReferencias(dto: CrearAderezoDto | EditarAderezoDto) {
    const ids = new Set<string>([
      ...(dto.categoriaIds ?? []),
      ...(dto.consumos ?? []).map((c) => c.categoriaId),
    ]);
    if (ids.size === 0) return;

    const existentes = await this.prisma.categoria.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true },
    });
    const encontradas = new Set(existentes.map((c) => c.id));
    const faltantes = [...ids].filter((id) => !encontradas.has(id));

    if (faltantes.length > 0) {
      throw new BadRequestException(
        `Estas categorias no existen: ${faltantes.join(', ')}`,
      );
    }
  }

  /**
   * `nombre` es UNIQUE en la base. Sin esto un duplicado sale como P2002 sin
   * atrapar y el filtro global lo convierte en un 500.
   *
   * La comparacion es case-insensitive aunque el indice no lo sea: "Mayonesa" y
   * "mayonesa" son la misma salsa para el que carga, y dejar que convivan
   * ensucia la carta para siempre.
   */
  private async rechazarNombreRepetido(nombre: string, ignorarId?: string) {
    const choque = await this.prisma.aderezo.findFirst({
      where: {
        nombre: { equals: nombre, mode: 'insensitive' },
        ...(ignorarId ? { id: { not: ignorarId } } : {}),
      },
      select: { id: true, nombre: true, activo: true },
    });

    if (!choque) return;

    throw new ConflictException(
      choque.activo
        ? `Ya hay una salsa que se llama "${choque.nombre}"`
        : `"${choque.nombre}" ya existe pero esta pausada. Reactivala en vez de crearla de nuevo.`,
    );
  }

  private async ensureExists(id: string) {
    const existe = await this.prisma.aderezo.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Aderezo no encontrado');
  }

  /** La misma escalera que `ESTADO_ADEREZO_SQL`, para lo que no pasa por SQL. */
  private estadoDe(aderezo: {
    activo: boolean;
    stockActual: number | Prisma.Decimal;
    stockMinimo: number | Prisma.Decimal;
  }): EstadoAderezo {
    if (!aderezo.activo) return 'PAUSADO';
    const actual = Number(aderezo.stockActual);
    if (actual <= 0) return 'SIN_STOCK';
    if (actual < Number(aderezo.stockMinimo)) return 'BAJO';
    return 'OK';
  }

  /** Fila cruda → item de la pantalla, con lo derivado ya resuelto. */
  private componerItem(
    fila: FilaAderezo,
    dias: number,
    categorias: Array<{ id: string; nombre: string }>,
  ) {
    const stockActual = Number(fila.stockActual);
    const consumido = Number(fila.consumido);
    const consumoDiario = consumido / dias;

    return {
      id: fila.id,
      nombre: fila.nombre,
      unidadMedida: fila.unidadMedida,
      stockActual: this.redondear(stockActual),
      stockMinimo: this.redondear(Number(fila.stockMinimo)),
      estado: fila.estado,
      activo: fila.activo,

      /** Las salsas son siempre gratis: no hay precio que mostrar ni editar. */
      gratis: true as const,

      alcance: {
        esGlobal: fila.esGlobal,
        /** Vacio cuando es global: se ofrece en todas, no en una lista. */
        categorias,
        /** Ni global ni con categorias: no se ofrece en ningun lado. */
        sinAlcance: !fila.esGlobal && categorias.length === 0,
      },

      configuracion: {
        consumosPorCategoria: fila.consumos,
        /**
         * En cuantas categorias donde se ofrece descuenta 1 a ciegas. Post
         * backfill tendria que ser 0 para todo lo que ya existia; lo que se
         * cree desde el panel no puede llegar a otro valor.
         */
        consumosFaltantes: fila.consumosFaltantes,
      },

      consumo: {
        ventanaDias: dias,
        total: this.redondear(consumido),
        movimientos: fila.movimientos,
        diario: this.redondear(consumoDiario),
        /**
         * Cuantos dias aguanta al ritmo de la ventana. `null` cuando no hubo
         * consumo: no es "infinitos dias", es "no hay con que estimarlo". El
         * mockup lo muestra como "sin consumo registrado".
         */
        diasDeAguante:
          consumoDiario > 0
            ? this.redondear(stockActual / consumoDiario)
            : null,
      },
    };
  }

  /** Fila cruda → item del bloque "reponer primero". */
  private componerAgotan(fila: FilaAgotan, dias: number) {
    const stockActual = Number(fila.stockActual);
    const consumoDiario = Number(fila.consumido) / dias;

    return {
      id: fila.id,
      nombre: fila.nombre,
      unidadMedida: fila.unidadMedida,
      stockActual: this.redondear(stockActual),
      stockMinimo: this.redondear(Number(fila.stockMinimo)),
      estado: fila.estado,
      consumoDiario: this.redondear(consumoDiario),
      // El JOIN del query ya garantiza consumido > 0, asi que aca no hay null.
      diasDeAguante: this.redondear(stockActual / consumoDiario),
    };
  }

  /** Dos decimales, como el resto del panel. */
  private redondear(valor: number): number {
    if (!Number.isFinite(valor)) return 0;
    return Math.round(valor * 100) / 100;
  }

  /** Un decimal, como el resto de los porcentajes del panel. */
  private porcentaje(parte: number, total: number): number {
    if (total <= 0) return 0;
    return Math.round((parte / total) * 1000) / 10;
  }
}
