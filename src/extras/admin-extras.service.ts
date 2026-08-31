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
  BAJO_MINIMO_EXTRA_SQL,
  ESTADO_EXTRA_SQL,
  EXTRAS_EXPANDIDOS,
  SIN_STOCK_EXTRA_SQL,
  cteVentasDeExtras,
  type EstadoExtra,
} from './extras.sql';
import {
  AdminExtrasQueryDto,
  AlcanceExtra,
  DIAS_VENTAS_POR_DEFECTO,
  DisponibilidadExtra,
  EstadoStockExtra,
  OrdenExtras,
  PAGE_SIZE_MAXIMO,
  PAGE_SIZE_POR_DEFECTO,
} from './dto/admin-extras-query.dto';
import { CrearExtraDto, EditarExtraDto } from './dto/admin-extra.dto';

/** Cuantos extras entran en el "share" de facturacion del header. */
const TOP_SHARE = 4;

/** Limites del historial de movimientos. Mismos numeros que Insumos. */
export const LIMITE_MOVIMIENTOS_POR_DEFECTO = 50;
export const LIMITE_MOVIMIENTOS_MAXIMO = 200;

interface Rango {
  inicio: Date;
  fin: Date;
}

/** Una fila del listado, tal como sale del `$queryRaw`. */
interface FilaExtra {
  id: string;
  nombre: string;
  precio: number;
  unidadMedida: string;
  stockActual: number;
  stockMinimo: number;
  activo: boolean;
  esGlobal: boolean;
  esPremium: boolean;
  estado: EstadoExtra;
  insumoId: string | null;
  insumoNombre: string | null;
  categorias: number;
  precios: number;
  consumos: number;
  unidades: number;
  gratis: number;
  cobrados: number;
  recaudado: number;
}

/**
 * ORDER BY por cada orden soportado.
 *
 * Se arma como SQL literal, asi que la unica entrada posible es el enum del
 * DTO (el ValidationPipe rechaza cualquier otra cosa antes de llegar aca).
 * Todos terminan en `e."id"` para que la paginacion sea estable.
 */
const ORDEN_SQL: Record<OrdenExtras, Prisma.Sql> = {
  // Cuanto le queda EN PROPORCION a su propio minimo, igual que en Insumos.
  [OrdenExtras.POR_REPONER]: Prisma.sql`
    (e."stockActual" / GREATEST(e."stockMinimo", 1)) ASC, e."nombre" ASC, e."id" ASC
  `,
  [OrdenExtras.MAS_PEDIDOS]: Prisma.sql`
    COALESCE(v.unidades, 0) DESC, e."nombre" ASC, e."id" ASC
  `,
  [OrdenExtras.MAS_FACTURADO]: Prisma.sql`
    COALESCE(v.recaudado, 0) DESC, e."nombre" ASC, e."id" ASC
  `,
  [OrdenExtras.PRECIO_DESC]: Prisma.sql`e."precio" DESC, e."nombre" ASC, e."id" ASC`,
  [OrdenExtras.PRECIO_ASC]: Prisma.sql`e."precio" ASC, e."nombre" ASC, e."id" ASC`,
  [OrdenExtras.ALFABETICO]: Prisma.sql`e."nombre" ASC, e."id" ASC`,
};

/**
 * Toda la pantalla de Extras del panel en una sola request.
 *
 * Mismo criterio que el resto del rework: el front vive en Vercel y la API en
 * Hetzner, cada fetch server-side es un round trip, y ningun total se calcula
 * trayendo filas. La busqueda, los filtros, el orden (incluido "mas pedidos",
 * que ordena por un agregado sobre el JSONB de los pedidos) y la paginacion
 * los resuelve Postgres.
 *
 * QUE NO HACE ESTA CLASE: no toca la logica de descuento de stock. El consumo
 * por categoria (`ExtraConsumo`) se LEE y se EDITA desde aca, pero quien lo
 * aplica al vender sigue siendo `PedidosService.getExtraConsumo`, sin cambios.
 * Lo unico que cambia es que ahora ese valor se puede cargar desde el panel en
 * vez de quedar sin configurar y caer al default de 1.
 */
@Injectable()
export class AdminExtrasService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------- listado

  async listar(query: AdminExtrasQueryDto, ahora: Date = new Date()) {
    const page = query.page ?? 1;
    const pageSize = Math.min(
      query.pageSize ?? PAGE_SIZE_POR_DEFECTO,
      PAGE_SIZE_MAXIMO,
    );
    const orden = query.orden ?? OrdenExtras.POR_REPONER;
    const estado = query.estado ?? EstadoStockExtra.TODOS;
    const disponibilidad = query.disponibilidad ?? DisponibilidadExtra.ACTIVOS;
    const alcance = query.alcance ?? AlcanceExtra.TODOS;
    const dias = query.dias ?? DIAS_VENTAS_POR_DEFECTO;
    const offset = (page - 1) * pageSize;

    const ventana: Rango = {
      inicio: inicioVentanaDias(dias, ahora),
      fin: finDelDia(ahora),
    };

    const where = this.armarWhere(query, estado, disponibilidad, alcance);
    const ventas = cteVentasDeExtras(ventana.inicio, ventana.fin);

    const [filas, total, conteos, facturacion, categoriasDe] =
      await Promise.all([
        this.paginaDeExtras(ventas, where, orden, pageSize, offset),
        this.contarFiltrados(where),
        this.conteosDelHeader(),
        this.facturacionDeExtras(ventana),
        this.categoriasPorExtra(ventas, where, orden, pageSize, offset),
      ]);

    return {
      stats: {
        ...conteos,
        facturacion,
      },

      items: filas.map((fila) =>
        this.componerItem(fila, categoriasDe.get(fila.id) ?? []),
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
        premium: query.premium ?? null,
        categoriaId: query.categoriaId ?? null,
        orden,
      },

      /** Ventana sobre la que se midieron las ventas de `items` y del header. */
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
    query: AdminExtrasQueryDto,
    estado: EstadoStockExtra,
    disponibilidad: DisponibilidadExtra,
    alcance: AlcanceExtra,
  ): Prisma.Sql {
    const condiciones: Prisma.Sql[] = [];

    if (disponibilidad === DisponibilidadExtra.ACTIVOS) {
      condiciones.push(Prisma.sql`e."activo" = true`);
    } else if (disponibilidad === DisponibilidadExtra.PAUSADOS) {
      condiciones.push(Prisma.sql`e."activo" = false`);
    }

    if (estado === EstadoStockExtra.SIN_STOCK) {
      condiciones.push(Prisma.sql`e."stockActual" <= 0`);
    } else if (estado === EstadoStockExtra.BAJO) {
      condiciones.push(
        Prisma.sql`e."stockActual" > 0 AND e."stockActual" < e."stockMinimo"`,
      );
    } else if (estado === EstadoStockExtra.POR_REPONER) {
      condiciones.push(Prisma.sql`e."stockActual" < e."stockMinimo"`);
    } else if (estado === EstadoStockExtra.OK) {
      condiciones.push(
        Prisma.sql`e."stockActual" > 0 AND e."stockActual" >= e."stockMinimo"`,
      );
    }

    if (query.premium === 'true') {
      condiciones.push(Prisma.sql`e."esPremium" = true`);
    } else if (query.premium === 'false') {
      condiciones.push(Prisma.sql`e."esPremium" = false`);
    }

    // El alcance es "donde se ofrece": global, acotado, o en ningun lado.
    if (alcance === AlcanceExtra.GLOBALES) {
      condiciones.push(Prisma.sql`e."esGlobal" = true`);
    } else if (alcance === AlcanceExtra.POR_CATEGORIA) {
      condiciones.push(Prisma.sql`
        e."esGlobal" = false
        AND EXISTS (SELECT 1 FROM "ExtraCategoria" ec WHERE ec."extraId" = e."id")
      `);
    } else if (alcance === AlcanceExtra.SIN_ALCANCE) {
      condiciones.push(Prisma.sql`
        e."esGlobal" = false
        AND NOT EXISTS (SELECT 1 FROM "ExtraCategoria" ec WHERE ec."extraId" = e."id")
      `);
    }

    // "Los que se ofrecen en esta categoria": un global se ofrece en todas.
    if (query.categoriaId) {
      condiciones.push(Prisma.sql`(
        e."esGlobal" = true
        OR EXISTS (
          SELECT 1 FROM "ExtraCategoria" ec
          WHERE ec."extraId" = e."id" AND ec."categoriaId" = ${query.categoriaId}
        )
      )`);
    }

    const texto = query.q?.trim();
    if (texto) {
      // Los comodines del ILIKE se escapan: si alguien busca "50%" tiene que
      // buscar ese texto, no "50 seguido de cualquier cosa".
      const patron = `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      condiciones.push(Prisma.sql`e."nombre" ILIKE ${patron}`);
    }

    if (condiciones.length === 0) return Prisma.empty;
    return Prisma.sql`WHERE ${Prisma.join(condiciones, ' AND ')}`;
  }

  /** La pagina pedida, ya ordenada, derivada y recortada por Postgres. */
  private paginaDeExtras(
    ventas: Prisma.Sql,
    where: Prisma.Sql,
    orden: OrdenExtras,
    pageSize: number,
    offset: number,
  ) {
    return this.prisma.$queryRaw<FilaExtra[]>`
      WITH v AS (${ventas})
      SELECT e."id",
             e."nombre",
             e."precio"::float8              AS "precio",
             e."unidadMedida",
             e."stockActual"::float8         AS "stockActual",
             e."stockMinimo"::float8         AS "stockMinimo",
             e."activo",
             e."esGlobal",
             e."esPremium",
             (${ESTADO_EXTRA_SQL})           AS "estado",
             e."insumoId",
             i."nombre"                      AS "insumoNombre",
             (SELECT COUNT(*) FROM "ExtraCategoria" ec WHERE ec."extraId" = e."id")::int AS "categorias",
             (SELECT COUNT(*) FROM "ExtraPrecio"   ep WHERE ep."extraId" = e."id")::int AS "precios",
             (SELECT COUNT(*) FROM "ExtraConsumo"  ex WHERE ex."extraId" = e."id")::int AS "consumos",
             COALESCE(v.unidades, 0)::int    AS "unidades",
             COALESCE(v.gratis, 0)::int      AS "gratis",
             COALESCE(v.cobrados, 0)::int    AS "cobrados",
             COALESCE(v.recaudado, 0)::float8 AS "recaudado"
      FROM "Extra" e
      LEFT JOIN v          ON v.id = e."id"
      LEFT JOIN "Insumo" i ON i."id" = e."insumoId"
      ${where}
      ORDER BY ${ORDEN_SQL[orden]}
      LIMIT ${pageSize} OFFSET ${offset}
    `;
  }

  /**
   * Las categorias de los extras de la pagina, en una query aparte.
   *
   * Va separada y no como agregado de la anterior porque un JOIN contra
   * "ExtraCategoria" multiplicaria las filas y romperia el LIMIT: la pagina
   * dejaria de tener `pageSize` extras. Repite el mismo WHERE/ORDER/LIMIT para
   * traer exactamente los mismos ids.
   */
  private async categoriasPorExtra(
    ventas: Prisma.Sql,
    where: Prisma.Sql,
    orden: OrdenExtras,
    pageSize: number,
    offset: number,
  ): Promise<Map<string, Array<{ id: string; nombre: string }>>> {
    const filas = await this.prisma.$queryRaw<
      Array<{ extraId: string; id: string; nombre: string }>
    >`
      WITH v AS (${ventas}),
      pagina AS (
        SELECT e."id"
        FROM "Extra" e
        LEFT JOIN v ON v.id = e."id"
        ${where}
        ORDER BY ${ORDEN_SQL[orden]}
        LIMIT ${pageSize} OFFSET ${offset}
      )
      SELECT ec."extraId", c."id", c."nombre"
      FROM "ExtraCategoria" ec
      JOIN pagina p     ON p."id" = ec."extraId"
      JOIN "Categoria" c ON c."id" = ec."categoriaId"
      ORDER BY c."nombre" ASC
    `;

    const mapa = new Map<string, Array<{ id: string; nombre: string }>>();
    for (const fila of filas) {
      const lista = mapa.get(fila.extraId) ?? [];
      lista.push({ id: fila.id, nombre: fila.nombre });
      mapa.set(fila.extraId, lista);
    }
    return mapa;
  }

  /**
   * Total de la paginacion. Va en una query aparte y no como `COUNT(*) OVER ()`
   * de la anterior porque esa devuelve cero filas cuando la pagina queda vacia
   * y ahi el total se perderia justo cuando el front lo necesita.
   */
  private async contarFiltrados(where: Prisma.Sql): Promise<number> {
    const filas = await this.prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS total
      FROM "Extra" e
      ${where}
    `;
    return filas[0]?.total ?? 0;
  }

  /**
   * Los conteos del header. De la carta ENTERA, no de lo filtrado: describen
   * el estado del negocio, no el de la busqueda.
   *
   * `sinConsumoConfigurado` es el numero que justifica esta seccion: cuantos
   * extras se ofrecen en algun lado pero no tienen cargado cuanto consumen, y
   * por lo tanto descuentan 1 por defecto al venderse (ver el WARN de
   * `PedidosService.getExtraConsumo`). Un global cuenta como incompleto si le
   * falta la fila de CUALQUIER categoria activa, porque se ofrece en todas.
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
        premium: number;
        globales: number;
        sinAlcance: number;
        sinConsumoConfigurado: number;
      }>
    >`
      WITH cats AS (SELECT COUNT(*)::int AS n FROM "Categoria" WHERE "activo")
      SELECT
        COUNT(*)::int                                                  AS "total",
        COUNT(*) FILTER (WHERE e."activo")::int                        AS "activos",
        COUNT(*) FILTER (WHERE NOT e."activo")::int                    AS "pausados",
        COUNT(*) FILTER (
          WHERE e."activo" AND e."stockActual" > 0
            AND e."stockActual" >= e."stockMinimo")::int               AS "ok",
        COUNT(*) FILTER (
          WHERE e."activo" AND e."stockActual" > 0
            AND e."stockActual" < e."stockMinimo")::int                AS "bajo",
        COUNT(*) FILTER (WHERE ${SIN_STOCK_EXTRA_SQL})::int            AS "sinStock",
        COUNT(*) FILTER (WHERE ${BAJO_MINIMO_EXTRA_SQL})::int          AS "porReponer",
        COUNT(*) FILTER (WHERE e."activo" AND e."esPremium")::int      AS "premium",
        COUNT(*) FILTER (WHERE e."activo" AND e."esGlobal")::int       AS "globales",
        COUNT(*) FILTER (
          WHERE e."activo" AND NOT e."esGlobal"
            AND NOT EXISTS (
              SELECT 1 FROM "ExtraCategoria" ec WHERE ec."extraId" = e."id"))::int
                                                                       AS "sinAlcance",
        COUNT(*) FILTER (
          WHERE e."activo" AND (
            CASE
              -- Global: necesita una fila por cada categoria activa.
              WHEN e."esGlobal" THEN
                (SELECT COUNT(*) FROM "ExtraConsumo" xc
                  JOIN "Categoria" c ON c."id" = xc."categoriaId" AND c."activo"
                 WHERE xc."extraId" = e."id") < (SELECT n FROM cats)
              -- Acotado: una por cada categoria donde se ofrece.
              ELSE EXISTS (
                SELECT 1 FROM "ExtraCategoria" ec
                WHERE ec."extraId" = e."id"
                  AND NOT EXISTS (
                    SELECT 1 FROM "ExtraConsumo" xc
                    WHERE xc."extraId" = e."id"
                      AND xc."categoriaId" = ec."categoriaId"))
            END
          ))::int                                                      AS "sinConsumoConfigurado"
      FROM "Extra" e
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
      premium: c?.premium ?? 0,
      globales: c?.globales ?? 0,
      /** Activos que no se ofrecen en ningun lado: existen pero nadie los ve. */
      sinAlcance: c?.sinAlcance ?? 0,
      /** Activos que descuentan 1 por defecto en al menos una categoria. */
      sinConsumoConfigurado: c?.sinConsumoConfigurado ?? 0,
    };
  }

  /**
   * La tarjeta de facturacion del header.
   *
   * Misma fuente y mismo criterio que `StatsService.extrasGratisVsCobrado`: se
   * cuenta sobre el JSON de `PedidoDetalle.extras` de pedidos ENTREGADOS, y el
   * flag `cobrado` ya viene resuelto del momento del pedido.
   *
   * El total NO se suma sobre el share: el share es el top 4 y sumarlo daria
   * un recaudado menor que el real. Van en la misma query, el total sin FILTER
   * y el share con LIMIT aparte.
   */
  private async facturacionDeExtras(ventana: Rango) {
    const [totales, share] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          unidades: number;
          gratis: number;
          cobrados: number;
          recaudado: number;
          recaudadoPremium: number;
        }>
      >`
        SELECT
          COUNT(*)::int AS "unidades",
          COUNT(*) FILTER (
            WHERE NOT COALESCE((ex->>'cobrado')::boolean, false))::int AS "gratis",
          COUNT(*) FILTER (
            WHERE COALESCE((ex->>'cobrado')::boolean, false))::int     AS "cobrados",
          COALESCE(SUM(COALESCE((ex->>'precio')::float8, 0)) FILTER (
            WHERE COALESCE((ex->>'cobrado')::boolean, false)), 0)::float8
                                                                       AS "recaudado",
          COALESCE(SUM(COALESCE((ex->>'precio')::float8, 0)) FILTER (
            WHERE COALESCE((ex->>'cobrado')::boolean, false)
              AND e."esPremium"), 0)::float8                           AS "recaudadoPremium"
        FROM "PedidoDetalle" pd
        JOIN "Pedido" ped ON ped."id" = pd."pedidoId"
        ${EXTRAS_EXPANDIDOS}
        LEFT JOIN "Extra" e ON e."id" = ex->>'id'
        WHERE ped."estado" = 'ENTREGADO'
          AND ped."createdAt" >= ${ventana.inicio}
          AND ped."createdAt" <= ${ventana.fin}
      `,
      this.prisma.$queryRaw<
        Array<{
          id: string;
          nombre: string;
          unidades: number;
          recaudado: number;
        }>
      >`
        SELECT ex->>'id'                        AS "id",
               COALESCE(MAX(e."nombre"), MAX(ex->>'nombre'), 'Extra eliminado')
                                                AS "nombre",
               COUNT(*)::int                    AS "unidades",
               COALESCE(SUM(COALESCE((ex->>'precio')::float8, 0)) FILTER (
                 WHERE COALESCE((ex->>'cobrado')::boolean, false)), 0)::float8
                                                AS "recaudado"
        FROM "PedidoDetalle" pd
        JOIN "Pedido" ped ON ped."id" = pd."pedidoId"
        ${EXTRAS_EXPANDIDOS}
        LEFT JOIN "Extra" e ON e."id" = ex->>'id'
        WHERE ped."estado" = 'ENTREGADO'
          AND ped."createdAt" >= ${ventana.inicio}
          AND ped."createdAt" <= ${ventana.fin}
        GROUP BY ex->>'id'
        ORDER BY 4 DESC, 3 DESC
        LIMIT ${TOP_SHARE}
      `,
    ]);

    const t = totales[0];
    const recaudado = Number(t?.recaudado ?? 0);
    const cobrados = Number(t?.cobrados ?? 0);

    return {
      unidades: t?.unidades ?? 0,
      gratis: t?.gratis ?? 0,
      cobrados,
      recaudado: this.redondear(recaudado),
      /**
       * Cuanto de lo facturado salio de extras premium. El premium siempre se
       * cobra, asi que este numero dice cuanta de la facturacion NO depende
       * del cupo de extras gratis de cada categoria.
       */
      recaudadoPremium: this.redondear(Number(t?.recaudadoPremium ?? 0)),
      pctPremium: this.porcentaje(Number(t?.recaudadoPremium ?? 0), recaudado),
      /**
       * Promedio sobre los COBRADOS, no sobre las unidades: dividir por los
       * gratis daria un "precio promedio" mas bajo que cualquier precio real.
       */
      precioPromedio: cobrados > 0 ? this.redondear(recaudado / cobrados) : 0,
      pctGratis: this.porcentaje(
        Number(t?.gratis ?? 0),
        Number(t?.unidades ?? 0),
      ),
      share: share.map((fila) => ({
        id: fila.id,
        nombre: fila.nombre,
        unidades: fila.unidades,
        recaudado: this.redondear(Number(fila.recaudado)),
        pct: this.porcentaje(Number(fila.recaudado), recaudado),
      })),
    };
  }

  // ------------------------------------------------------------- detalle

  /**
   * La ficha completa, con TODO lo editable.
   *
   * Devuelve una fila por cada categoria activa (no solo por las que el extra
   * tiene configuradas) con su precio y su consumo efectivos, y con las
   * banderas que dicen si ese valor esta cargado o si sale de un default. Es
   * la unica forma de que el form pueda mostrar "este consumo no esta
   * configurado y por eso descuenta 1".
   */
  async detalle(id: string) {
    const extra = await this.prisma.extra.findUnique({
      where: { id },
      include: {
        insumo: { select: { id: true, nombre: true, stockActual: true } },
        categoriasAplica: { select: { categoriaId: true } },
        preciosPorCategoria: { select: { categoriaId: true, precio: true } },
        consumosPorCategoria: {
          select: { categoriaId: true, cantidadConsumo: true },
        },
      },
    });

    if (!extra) throw new NotFoundException('Extra no encontrado');

    /**
     * TODAS las categorias, no solo las activas.
     *
     * El consumo es obligatorio donde el extra se ofrece, y esa validacion
     * corre sobre todas las categorias (ver `validarConsumoCompleto`). Si la
     * ficha devolviera solo las activas, desactivar una categoria dejaria al
     * extra INEDITABLE: el form no tendria donde cargar el consumo que la
     * validacion le va a exigir. Cada fila trae `activa` para que la pantalla
     * pueda ordenarlas o atenuarlas.
     */
    const categorias = await this.prisma.categoria.findMany({
      select: {
        id: true,
        nombre: true,
        activo: true,
        cantExtrasGratis: true,
        sinExtrasNiAderezos: true,
      },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    });

    const aplicaEn = new Set(extra.categoriasAplica.map((c) => c.categoriaId));
    const precioDe = new Map(
      extra.preciosPorCategoria.map((p) => [p.categoriaId, Number(p.precio)]),
    );
    const consumoDe = new Map(
      extra.consumosPorCategoria.map((c) => [
        c.categoriaId,
        Number(c.cantidadConsumo),
      ]),
    );

    const filas = categorias.map((categoria) => {
      const aplica = extra.esGlobal || aplicaEn.has(categoria.id);
      const precio = precioDe.get(categoria.id) ?? null;
      const consumo = consumoDe.get(categoria.id) ?? null;

      return {
        categoriaId: categoria.id,
        nombre: categoria.nombre,
        /** La categoria esta dada de alta. Una inactiva igual se puede editar. */
        activa: categoria.activo,
        /** Si el extra se ofrece en esta categoria hoy. */
        aplica,
        /**
         * La categoria no admite extras: aunque el extra sea global, aca no
         * aparece (`Categoria.sinExtrasNiAderezos` anula incluso los globales).
         */
        admiteExtras: !categoria.sinExtrasNiAderezos,
        cantExtrasGratis: categoria.cantExtrasGratis,

        precio,
        /** El que se cobra de verdad: el propio, o el base si no hay propio. */
        precioEfectivo: precio ?? Number(extra.precio),
        precioEnDefault: precio === null,

        consumo,
        /**
         * El que se descuenta de verdad. El 1 NO es una decision de negocio:
         * es el fallback de `PedidosService.getExtraConsumo` cuando no hay
         * fila, y por eso `consumoEnDefault` existe.
         */
        consumoEfectivo: consumo ?? 1,
        consumoEnDefault: consumo === null,
        /** Se ofrece aca Y no tiene consumo cargado: descuenta 1 a ciegas. */
        consumoFaltante: aplica && consumo === null,
      };
    });

    return {
      id: extra.id,
      nombre: extra.nombre,
      precio: Number(extra.precio),
      unidadMedida: extra.unidadMedida,
      stockActual: Number(extra.stockActual),
      stockMinimo: Number(extra.stockMinimo),
      activo: extra.activo,
      esGlobal: extra.esGlobal,
      esPremium: extra.esPremium,
      estado: this.estadoDe(extra),
      createdAt: extra.createdAt,
      updatedAt: extra.updatedAt,

      /**
       * De donde sale el stock. Con insumo, el descuento va contra el insumo y
       * `stockActual` del extra queda sin usar: la pantalla tiene que decirlo.
       */
      insumo: extra.insumo
        ? {
            id: extra.insumo.id,
            nombre: extra.insumo.nombre,
            stockActual: Number(extra.insumo.stockActual),
          }
        : null,

      alcance: {
        esGlobal: extra.esGlobal,
        categoriaIds: [...aplicaEn],
        /** En cuantas categorias activas se ofrece hoy. */
        categoriasAlcanzadas: filas.filter((f) => f.aplica).length,
      },

      /** Una fila por categoria activa, con precio y consumo editables. */
      categorias: filas,

      resumen: {
        preciosConfigurados: filas.filter((f) => !f.precioEnDefault).length,
        consumosConfigurados: filas.filter((f) => !f.consumoEnDefault).length,
        /** Cuantas categorias donde SE OFRECE no tienen consumo cargado. */
        consumosFaltantes: filas.filter((f) => f.consumoFaltante).length,
      },
    };
  }

  // ------------------------------------------------------------- escritura

  async crear(dto: CrearExtraDto) {
    const nombre = dto.nombre.trim();
    await this.rechazarNombreRepetido(nombre);
    await this.validarReferencias(dto);
    await this.validarConsumoCompleto(dto);

    const creado = await this.prisma.$transaction(async (tx) => {
      const extra = await tx.extra.create({
        data: {
          nombre,
          precio: dto.precio ?? 500,
          unidadMedida: dto.unidadMedida ?? 'un',
          stockActual: dto.stockActual ?? 0,
          stockMinimo: dto.stockMinimo,
          // `esPremium` se escribe explicitamente: el `create` del service
          // viejo lo aceptaba en el DTO y NO lo guardaba, asi que no se podia
          // dar de alta un extra premium sin editarlo despues.
          esPremium: dto.esPremium ?? false,
          activo: dto.activo ?? true,
          esGlobal: dto.esGlobal ?? false,
          insumoId: dto.insumoId ?? null,
        },
      });

      await this.reemplazarConfiguracion(tx, extra.id, dto);
      return extra;
    });

    return this.detalle(creado.id);
  }

  /**
   * Edicion. Los tres bloques de configuracion son reemplazo completo cuando
   * vienen y quedan intactos cuando no.
   *
   * Todo va en una transaccion: un extra que quede con las categorias nuevas y
   * los consumos viejos es exactamente el estado desalineado que esta seccion
   * viene a arreglar.
   */
  async editar(id: string, dto: EditarExtraDto) {
    const actual = await this.prisma.extra.findUnique({
      where: { id },
      select: {
        esGlobal: true,
        categoriasAplica: { select: { categoriaId: true } },
        consumosPorCategoria: { select: { categoriaId: true } },
      },
    });
    if (!actual) throw new NotFoundException('Extra no encontrado');

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

    await this.prisma.$transaction(async (tx) => {
      await tx.extra.update({
        where: { id },
        data: {
          nombre,
          precio: dto.precio,
          unidadMedida: dto.unidadMedida,
          stockActual: dto.stockActual,
          stockMinimo: dto.stockMinimo,
          esPremium: dto.esPremium,
          activo: dto.activo,
          esGlobal: dto.esGlobal,
          insumoId: dto.insumoId,
        },
      });

      await this.reemplazarConfiguracion(tx, id, dto);
    });

    return this.detalle(id);
  }

  async setActivo(id: string, activo: boolean) {
    await this.ensureExists(id);
    await this.prisma.extra.update({
      where: { id },
      data: { activo: Boolean(activo) },
    });
    return this.detalle(id);
  }

  /**
   * Borrado real, con el mismo guard que Productos: si ya se vendio, no se
   * borra.
   *
   * El chequeo tiene que mirar el JSONB de `PedidoDetalle.extras` porque ahi
   * NO hay foreign key — el extra viaja como snapshot dentro del JSON. Sin
   * este guard, borrar un extra vendido deja los movimientos de stock
   * huerfanos (`StockMovimiento.extraId` es ON DELETE SET NULL) y las
   * estadisticas mostrando "Extra eliminado" sin forma de recuperar cual era.
   */
  async eliminar(id: string) {
    await this.ensureExists(id);

    const [{ usado }] = await this.prisma.$queryRaw<Array<{ usado: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM "PedidoDetalle" pd
        ${EXTRAS_EXPANDIDOS}
        WHERE ex->>'id' = ${id}
      ) AS usado
    `;

    if (usado) {
      throw new BadRequestException(
        'No se puede eliminar un extra que ya tiene ventas: se perderia el ' +
          'historial de los pedidos donde aparece. Pausalo (activo=false) para ' +
          'sacarlo de la carta.',
      );
    }

    /**
     * Nunca se vendio: se borra de verdad, con toda su configuracion.
     *
     * Los movimientos de stock se borran junto con el extra y NO bloquean el
     * borrado. El criterio es el de Productos —lo unico que impide eliminar es
     * haber sido usado en pedidos— y aca eso ya quedo descartado: si nunca se
     * vendio, los unicos movimientos posibles son ajustes manuales sobre un
     * extra que no llego a usarse. Se borran en vez de dejarse porque el FK es
     * ON DELETE SET NULL: sobrevivirian como filas con `extraId` en null,
     * invisibles para todos los historiales y sin forma de saber de quien eran.
     */
    await this.prisma.$transaction(async (tx) => {
      await tx.stockMovimiento.deleteMany({ where: { extraId: id } });
      await tx.extraPrecio.deleteMany({ where: { extraId: id } });
      await tx.extraConsumo.deleteMany({ where: { extraId: id } });
      await tx.extraCategoria.deleteMany({ where: { extraId: id } });
      await tx.extra.delete({ where: { id } });
    });

    return { ok: true, id };
  }

  // ------------------------------------------------------------- historial

  /**
   * Historial de movimientos de stock de un extra.
   *
   * El dato EXISTE: `StockMovimiento` tiene `extraId` desde la migracion
   * 20260511003757 y hay indice `[extraId]`. Lo escriben el descuento por
   * pedido y los ajustes manuales.
   *
   * OJO con los extras que descuentan de un insumo (`insumoId`): en ese caso
   * el movimiento se registra contra el INSUMO, no contra el extra, asi que
   * este historial va a venir vacio. Se dice en la respuesta con
   * `descuentaDelInsumo` para que la pantalla pueda mandar al historial del
   * insumo en vez de mostrar un vacio inexplicable.
   */
  async historial(id: string, limitPedido?: number) {
    const extra = await this.prisma.extra.findUnique({
      where: { id },
      select: {
        id: true,
        nombre: true,
        unidadMedida: true,
        stockActual: true,
        stockMinimo: true,
        activo: true,
        insumo: { select: { id: true, nombre: true } },
      },
    });
    if (!extra) throw new NotFoundException('Extra no encontrado');

    const take = Math.min(
      Math.max(limitPedido ?? LIMITE_MOVIMIENTOS_POR_DEFECTO, 1),
      LIMITE_MOVIMIENTOS_MAXIMO,
    );

    const [movimientos, total] = await Promise.all([
      this.prisma.stockMovimiento.findMany({
        where: { extraId: id },
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
      this.prisma.stockMovimiento.count({ where: { extraId: id } }),
    ]);

    return {
      extra: {
        id: extra.id,
        nombre: extra.nombre,
        unidadMedida: extra.unidadMedida,
        stockActual: Number(extra.stockActual),
        stockMinimo: Number(extra.stockMinimo),
        activo: extra.activo,
        estado: this.estadoDe(extra),
      },
      /** Si es true, los movimientos reales estan en el historial del insumo. */
      descuentaDelInsumo: extra.insumo
        ? { id: extra.insumo.id, nombre: extra.insumo.nombre }
        : null,
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
   * Reemplaza los tres bloques de configuracion.
   *
   * Solo toca el bloque que vino en el body: `undefined` es "no lo toques" y
   * `[]` es "borralos todos". Se hace con deleteMany + createMany en vez de
   * upsert fila por fila porque el set completo es el que manda: un upsert
   * dejaria vivas las filas que el usuario saco del form.
   */
  private async reemplazarConfiguracion(
    tx: Prisma.TransactionClient,
    extraId: string,
    dto: CrearExtraDto | EditarExtraDto,
  ) {
    if (dto.categoriaIds !== undefined) {
      await tx.extraCategoria.deleteMany({ where: { extraId } });
      if (dto.categoriaIds.length > 0) {
        await tx.extraCategoria.createMany({
          data: [...new Set(dto.categoriaIds)].map((categoriaId) => ({
            extraId,
            categoriaId,
          })),
          skipDuplicates: true,
        });
      }
    }

    if (dto.precios !== undefined) {
      await tx.extraPrecio.deleteMany({ where: { extraId } });
      if (dto.precios.length > 0) {
        await tx.extraPrecio.createMany({
          data: dto.precios.map((p) => ({
            extraId,
            categoriaId: p.categoriaId,
            precio: p.precio,
          })),
          skipDuplicates: true,
        });
      }
    }

    if (dto.consumos !== undefined) {
      await tx.extraConsumo.deleteMany({ where: { extraId } });
      if (dto.consumos.length > 0) {
        await tx.extraConsumo.createMany({
          data: dto.consumos.map((c) => ({
            extraId,
            categoriaId: c.categoriaId,
            cantidadConsumo: c.cantidadConsumo,
          })),
          skipDuplicates: true,
        });
      }
    }
  }

  /**
   * REGLA DURA: donde el extra se ofrece, tiene que estar cargado cuanto
   * consume.
   *
   * Es la que cierra de raiz el agujero del default. `getExtraConsumo` de
   * PedidosService descuenta 1 cuando no encuentra la fila de
   * (extra, categoria); con esta validacion esa fila no puede faltar, asi que
   * el fallback deja de alcanzarse por configuracion incompleta.
   *
   * Se valida sobre el ESTADO FINAL, no sobre el body: un PATCH que solo
   * cambia el nombre no puede fallar porque no mando consumos. Para cada uno
   * de los tres bloques, lo que manda es el valor entrante si vino, y el que
   * ya estaba si no.
   *
   * "Donde se ofrece" son TODAS las categorias cuando `esGlobal` es true —no
   * las que tenga en `ExtraCategoria`, que un global ignora— y las de
   * `categoriaIds` cuando no lo es. Sin filtrar por `Categoria.activo`: el
   * descuento al vender busca por el `categoriaId` del producto sin mirar si
   * la categoria esta activa, asi que una inactiva con productos igual caeria
   * al default.
   */
  private async validarConsumoCompleto(
    dto: CrearExtraDto | EditarExtraDto,
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

    // Se nombran las que faltan, acotado: con un global sobre muchas
    // categorias la lista entera seria ilegible.
    const nombres = faltantes.slice(0, 5).map((c) => c.nombre);
    const resto =
      faltantes.length > nombres.length
        ? ` y ${faltantes.length - nombres.length} mas`
        : '';

    throw new BadRequestException(
      esGlobal
        ? `Este extra es global (se ofrece en toda la carta), asi que necesita el consumo cargado en TODAS las categorias. Falta en: ${nombres.join(', ')}${resto}.`
        : `No se puede ofrecer un extra en una categoria sin decir cuanto descuenta. Falta el consumo en: ${nombres.join(', ')}${resto}.`,
    );
  }

  /**
   * Que los ids que vienen en el body existan de verdad.
   *
   * Sin esto, un `categoriaId` inexistente sale como P2003 (violacion de FK) y
   * el filtro global lo convierte en un 500 que no le dice nada a nadie.
   */
  private async validarReferencias(dto: CrearExtraDto | EditarExtraDto) {
    if (dto.insumoId) {
      const insumo = await this.prisma.insumo.findUnique({
        where: { id: dto.insumoId },
        select: { id: true },
      });
      if (!insumo) {
        throw new BadRequestException(`El insumo ${dto.insumoId} no existe`);
      }
    }

    const ids = new Set<string>([
      ...(dto.categoriaIds ?? []),
      ...(dto.precios ?? []).map((p) => p.categoriaId),
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
   * La comparacion es case-insensitive aunque el indice no lo sea: "Cheddar" y
   * "cheddar" son el mismo extra para el que carga, y dejar que convivan
   * ensucia la carta para siempre.
   */
  private async rechazarNombreRepetido(nombre: string, ignorarId?: string) {
    const choque = await this.prisma.extra.findFirst({
      where: {
        nombre: { equals: nombre, mode: 'insensitive' },
        ...(ignorarId ? { id: { not: ignorarId } } : {}),
      },
      select: { id: true, nombre: true, activo: true },
    });

    if (!choque) return;

    throw new ConflictException(
      choque.activo
        ? `Ya hay un extra que se llama "${choque.nombre}"`
        : `"${choque.nombre}" ya existe pero esta pausado. Reactivalo en vez de crearlo de nuevo.`,
    );
  }

  private async ensureExists(id: string) {
    const existe = await this.prisma.extra.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Extra no encontrado');
  }

  /** La misma escalera que `ESTADO_EXTRA_SQL`, para lo que no pasa por SQL. */
  private estadoDe(extra: {
    activo: boolean;
    stockActual: number | Prisma.Decimal;
    stockMinimo: number | Prisma.Decimal;
  }): EstadoExtra {
    if (!extra.activo) return 'PAUSADO';
    const actual = Number(extra.stockActual);
    if (actual <= 0) return 'SIN_STOCK';
    if (actual < Number(extra.stockMinimo)) return 'BAJO';
    return 'OK';
  }

  /** Fila cruda → item de la pantalla, con lo derivado ya resuelto. */
  private componerItem(
    fila: FilaExtra,
    categorias: Array<{ id: string; nombre: string }>,
  ) {
    return {
      id: fila.id,
      nombre: fila.nombre,
      precio: Number(fila.precio),
      unidadMedida: fila.unidadMedida,
      stockActual: this.redondear(Number(fila.stockActual)),
      stockMinimo: this.redondear(Number(fila.stockMinimo)),
      estado: fila.estado,
      esPremium: fila.esPremium,
      activo: fila.activo,

      insumo: fila.insumoId
        ? { id: fila.insumoId, nombre: fila.insumoNombre ?? '' }
        : null,

      alcance: {
        esGlobal: fila.esGlobal,
        /** Vacio cuando es global: se ofrece en todas, no en una lista. */
        categorias,
        /** Ni global ni con categorias: no se ofrece en ningun lado. */
        sinAlcance: !fila.esGlobal && categorias.length === 0,
      },

      configuracion: {
        preciosPorCategoria: fila.precios,
        consumosPorCategoria: fila.consumos,
      },

      ventas: {
        unidades: fila.unidades,
        gratis: fila.gratis,
        cobrados: fila.cobrados,
        recaudado: this.redondear(Number(fila.recaudado)),
      },
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
