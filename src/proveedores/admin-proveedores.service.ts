import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  BAJO_MINIMO_SQL,
  COMPRA_SUGERIDA_SQL,
  ESTADO_SQL,
  SIN_STOCK_SQL,
  type EstadoInsumo,
} from '../insumos/stock.sql';
import {
  AdminProveedoresQueryDto,
  EstadoProveedor,
  OrdenProveedores,
  PAGE_SIZE_MAXIMO,
  PAGE_SIZE_POR_DEFECTO,
} from './dto/admin-proveedores-query.dto';
import {
  CrearProveedorDto,
  EditarProveedorDto,
} from './dto/admin-proveedor.dto';

/** Cuantos proveedores entran en la tarjeta "hay que llamar a" del header. */
const TOP_A_LLAMAR = 8;

/** Cuantos entran en el ranking de "quien trae mas". */
const TOP_RANKING = 6;

/**
 * El tipo de movimiento del que se deriva la "ultima reposicion".
 *
 * ⚠️ LEER ESTO ANTES DE CONFIAR EN EL DATO. El sistema NO tiene ordenes de
 * compra: no hay ninguna tabla que registre "se le pidio X al proveedor Y". Lo
 * mas cercano en el ledger es `StockMovimiento`, y de sus tres tipos:
 *
 * - `REPOSICION` la escribe UNICAMENTE la cancelacion de un pedido de CLIENTE
 *   (`PedidosService`, motivo "Cancelación pedido: ..."). Es mercaderia que
 *   volvio al deposito porque no se uso, no mercaderia que trajo el proveedor.
 * - `AJUSTE_MANUAL` con cantidad > 0 (el `PATCH /insumos/:id/sumar`) es lo que
 *   en la practica se carga cuando entra una compra, mezclado con las
 *   correcciones de recuento.
 * - `DESCUENTO_PEDIDO` es consumo.
 *
 * Se usa `REPOSICION` porque es la decision tomada para esta seccion, y el
 * campo viaja rotulado como "ultima reposicion" (no como "ultimo pedido"), que
 * es literalmente lo que mide. Queda aislado en esta constante a proposito:
 * apuntarlo a las entradas de stock manuales es cambiar esta linea por
 * `Prisma.sql\`(m."tipo" = 'AJUSTE_MANUAL' AND m."cantidad" > 0)\`` y nada mas.
 */
const REPOSICION_SQL = Prisma.sql`m."tipo" = 'REPOSICION'`;

/** Una fila del listado, tal como sale del `$queryRaw`. */
interface FilaProveedor {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  notas: string | null;
  activo: boolean;
  insumos: number;
  insumosActivos: number;
  bajoMinimo: number;
  sinStock: number;
  compraSugerida: number;
  ultimaReposicionFecha: Date | null;
  ultimaReposicionCantidad: number | null;
  ultimaReposicionInsumo: string | null;
}

/** Un insumo del proveedor, en el listado de faltantes o en el detalle. */
interface FilaInsumo {
  id: string;
  nombre: string;
  unidadMedida: string;
  stockActual: number;
  stockMinimo: number;
  activo: boolean;
  estado: EstadoInsumo;
  compraSugerida: number;
}

/** Una fila del bloque "hay que llamar a": proveedor × insumo faltante. */
interface FilaALlamar extends FilaInsumo {
  proveedorId: string;
  proveedorNombre: string;
  proveedorTelefono: string | null;
  provBajoMinimo: number;
  provSinStock: number;
  provCompraSugerida: number;
}

/**
 * ORDER BY por cada orden soportado.
 *
 * Se arma como SQL literal, asi que la unica entrada posible es el enum del
 * DTO (el ValidationPipe rechaza cualquier otra cosa antes de llegar aca).
 * Todos terminan en `p."id"` para que la paginacion sea estable: sin un
 * desempate unico, dos proveedores con el mismo conteo pueden intercambiarse
 * entre paginas y aparecer repetidos o faltar.
 */
const ORDEN_SQL: Record<OrdenProveedores, Prisma.Sql> = {
  [OrdenProveedores.POR_LLAMAR]: Prisma.sql`
    COALESCE(a."bajoMinimo", 0) DESC, COALESCE(a."sinStock", 0) DESC,
    p."nombre" ASC, p."id" ASC
  `,
  [OrdenProveedores.ALFABETICO]: Prisma.sql`p."nombre" ASC, p."id" ASC`,
  [OrdenProveedores.MAS_INSUMOS]: Prisma.sql`
    COALESCE(a."insumos", 0) DESC, p."nombre" ASC, p."id" ASC
  `,
  // NULLS FIRST y no LAST: "nunca se le repuso nada" es el caso mas viejo que
  // existe, no la ausencia del dato.
  [OrdenProveedores.ULTIMA_REPOSICION]: Prisma.sql`
    r."fecha" ASC NULLS FIRST, p."nombre" ASC, p."id" ASC
  `,
};

/**
 * Toda la pantalla de Proveedores del panel en una sola request.
 *
 * Mismo criterio que /admin/home, /admin/estadisticas, /admin/productos y
 * /admin/insumos: el front vive en Vercel y la API en Hetzner, cada fetch
 * server-side es un round trip, y ningun total se calcula trayendo filas. Los
 * conteos por proveedor (cuantos insumos le cuelgan, cuantos estan bajo
 * minimo, cuanto habria que comprarle) son agregados de Postgres sobre
 * "Insumo", no `.filter()` sobre el deposito entero traido al cliente, que es
 * lo que hacia la pantalla vieja.
 *
 * "Bajo minimo" y "compra sugerida" NO se redefinen aca: se importan de
 * `insumos/stock.sql`, que es la misma expresion que usa la seccion de
 * Insumos. Es a proposito: si las dos pantallas contaran distinto, el header
 * de una contradiria al de la otra.
 */
@Injectable()
export class AdminProveedoresService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------- listado

  async listar(query: AdminProveedoresQueryDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(
      query.pageSize ?? PAGE_SIZE_POR_DEFECTO,
      PAGE_SIZE_MAXIMO,
    );
    const estado = this.resolverEstado(query);
    const orden = query.orden ?? OrdenProveedores.POR_LLAMAR;
    const offset = (page - 1) * pageSize;

    const where = this.armarWhere(query, estado);

    const [filas, total, conteos, cobertura, aLlamar, ranking] =
      await Promise.all([
        this.paginaDeProveedores(where, orden, pageSize, offset),
        this.contarFiltrados(where),
        this.conteosDeProveedores(),
        this.coberturaDelStock(),
        this.hayQueLlamarA(),
        this.quienTraeMas(),
      ]);

    return {
      stats: {
        ...conteos,
        /**
         * Cuantos insumos activos estan bajo su minimo y cuantos de esos no
         * tienen a quien pedirle. El segundo numero es el que justifica la
         * barra de cobertura: un insumo bajo minimo sin proveedor no aparece
         * en ninguna tarjeta de "hay que llamar a".
         */
        cobertura,
      },

      /**
       * La tarjeta "hay que llamar a" del header: los proveedores ACTIVOS con
       * al menos un insumo bajo minimo, con el detalle de que pedirles. Es
       * del padron entero, NO de lo filtrado: describe el estado del deposito,
       * no el de la busqueda.
       */
      aLlamar,

      /** "Quien trae mas": ranking por cantidad de insumos vinculados. */
      ranking,

      items: filas.map((fila) => this.componerItem(fila)),

      paginacion: {
        page,
        pageSize,
        total,
        totalPaginas: Math.max(1, Math.ceil(total / pageSize)),
      },

      filtros: {
        q: query.q?.trim() || null,
        estado,
        orden,
      },
    };
  }

  /**
   * Si vienen los dos, `estado` gana: es el explicito, `incluirArchivados` es
   * el atajo booleano para el toggle de la UI.
   */
  private resolverEstado(query: AdminProveedoresQueryDto): EstadoProveedor {
    if (query.estado) return query.estado;
    if (query.incluirArchivados) return EstadoProveedor.TODOS;
    return EstadoProveedor.ACTIVOS;
  }

  /** Filtros del listado. Todos los valores viajan parametrizados. */
  private armarWhere(
    query: AdminProveedoresQueryDto,
    estado: EstadoProveedor,
  ): Prisma.Sql {
    const condiciones: Prisma.Sql[] = [];

    if (estado === EstadoProveedor.ACTIVOS) {
      condiciones.push(Prisma.sql`p."activo" = true`);
    } else if (estado === EstadoProveedor.ARCHIVADOS) {
      condiciones.push(Prisma.sql`p."activo" = false`);
    }

    const texto = query.q?.trim();
    if (texto) {
      // Los comodines del ILIKE se escapan: si alguien busca "50%" tiene que
      // buscar ese texto, no "50 seguido de cualquier cosa".
      const patron = `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      condiciones.push(Prisma.sql`p."nombre" ILIKE ${patron}`);
    }

    if (condiciones.length === 0) return Prisma.empty;
    return Prisma.sql`WHERE ${Prisma.join(condiciones, ' AND ')}`;
  }

  /**
   * Los agregados de "Insumo" por proveedor, como CTE.
   *
   * Una sola pasada sobre la tabla que resuelve los cuatro numeros de la
   * tarjeta. Se comparte entre el listado, los conteos del header y el
   * ranking en vez de repetirse: son la misma cuenta.
   */
  private cteAgregados(): Prisma.Sql {
    return Prisma.sql`
      SELECT i."proveedorId"                                   AS "proveedorId",
             COUNT(*)::int                                     AS "insumos",
             COUNT(*) FILTER (WHERE i."activo")::int           AS "insumosActivos",
             COUNT(*) FILTER (WHERE ${BAJO_MINIMO_SQL})::int   AS "bajoMinimo",
             COUNT(*) FILTER (WHERE ${SIN_STOCK_SQL})::int     AS "sinStock",
             COALESCE(
               SUM(${COMPRA_SUGERIDA_SQL}) FILTER (WHERE ${BAJO_MINIMO_SQL}), 0
             )::float8                                         AS "compraSugerida"
      FROM "Insumo" i
      WHERE i."proveedorId" IS NOT NULL
      GROUP BY i."proveedorId"
    `;
  }

  /**
   * La ultima reposicion de cada proveedor, como CTE.
   *
   * `DISTINCT ON` es la forma barata en Postgres de quedarse con una fila por
   * grupo: ordena por (proveedor, fecha desc) y se queda con la primera de
   * cada proveedor, sin ventana ni subconsulta correlacionada.
   *
   * Ver `REPOSICION_SQL` por que este dato NO es "ultimo pedido al proveedor".
   */
  private cteUltimaReposicion(): Prisma.Sql {
    return Prisma.sql`
      SELECT DISTINCT ON (i."proveedorId")
             i."proveedorId"      AS "proveedorId",
             m."createdAt"        AS "fecha",
             m."cantidad"::float8 AS "cantidad",
             i."nombre"           AS "insumo"
      FROM "StockMovimiento" m
      JOIN "Insumo" i ON i."id" = m."insumoId"
      WHERE ${REPOSICION_SQL}
        AND i."proveedorId" IS NOT NULL
      ORDER BY i."proveedorId", m."createdAt" DESC
    `;
  }

  /** La pagina pedida, ya ordenada, derivada y recortada por Postgres. */
  private paginaDeProveedores(
    where: Prisma.Sql,
    orden: OrdenProveedores,
    pageSize: number,
    offset: number,
  ) {
    return this.prisma.$queryRaw<FilaProveedor[]>`
      WITH agg AS (${this.cteAgregados()}),
           r   AS (${this.cteUltimaReposicion()})
      SELECT p."id",
             p."nombre",
             p."telefono",
             p."email",
             p."notas",
             p."activo",
             COALESCE(a."insumos", 0)::int              AS "insumos",
             COALESCE(a."insumosActivos", 0)::int       AS "insumosActivos",
             COALESCE(a."bajoMinimo", 0)::int           AS "bajoMinimo",
             COALESCE(a."sinStock", 0)::int             AS "sinStock",
             COALESCE(a."compraSugerida", 0)::float8    AS "compraSugerida",
             r."fecha"                                  AS "ultimaReposicionFecha",
             r."cantidad"                               AS "ultimaReposicionCantidad",
             r."insumo"                                 AS "ultimaReposicionInsumo"
      FROM "Proveedor" p
      LEFT JOIN agg a ON a."proveedorId" = p."id"
      LEFT JOIN r     ON r."proveedorId" = p."id"
      ${where}
      ORDER BY ${ORDEN_SQL[orden]}
      LIMIT ${pageSize} OFFSET ${offset}
    `;
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
      FROM "Proveedor" p
      ${where}
    `;
    return filas[0]?.total ?? 0;
  }

  /**
   * Las tarjetas del header que hablan del padron.
   *
   * Del padron ENTERO, no de lo filtrado: describen el estado del negocio, no
   * el de la busqueda. `activos + archivados` da exactamente `total`.
   */
  private async conteosDeProveedores() {
    const filas = await this.prisma.$queryRaw<
      Array<{
        total: number;
        activos: number;
        archivados: number;
        aLlamar: number;
        sinTelefono: number;
        sinInsumos: number;
      }>
    >`
      WITH agg AS (${this.cteAgregados()})
      SELECT
        COUNT(*)::int                                                   AS "total",
        COUNT(*) FILTER (WHERE p."activo")::int                         AS "activos",
        COUNT(*) FILTER (WHERE NOT p."activo")::int                     AS "archivados",
        COUNT(*) FILTER (
          WHERE p."activo" AND COALESCE(a."bajoMinimo", 0) > 0)::int    AS "aLlamar",
        COUNT(*) FILTER (
          WHERE p."activo" AND p."telefono" IS NULL)::int               AS "sinTelefono",
        COUNT(*) FILTER (
          WHERE p."activo" AND COALESCE(a."insumos", 0) = 0)::int       AS "sinInsumos"
      FROM "Proveedor" p
      LEFT JOIN agg a ON a."proveedorId" = p."id"
    `;

    const c = filas[0];
    return {
      total: c?.total ?? 0,
      activos: c?.activos ?? 0,
      archivados: c?.archivados ?? 0,
      /** Activos con al menos un insumo bajo minimo. */
      aLlamar: c?.aLlamar ?? 0,
      /** Activos a los que no se les puede llamar porque no hay telefono. */
      sinTelefono: c?.sinTelefono ?? 0,
      /** Activos sin ningun insumo colgado: alta a medias o proveedor muerto. */
      sinInsumos: c?.sinInsumos ?? 0,
    };
  }

  /** La barra de "cobertura del stock": cuantos insumos tienen a quien pedirle. */
  private async coberturaDelStock() {
    const filas = await this.prisma.$queryRaw<
      Array<{
        insumos: number;
        conProveedor: number;
        sinProveedor: number;
        bajoMinimo: number;
        bajoMinimoSinProveedor: number;
        compraSugeridaTotal: number;
      }>
    >`
      SELECT
        COUNT(*) FILTER (WHERE i."activo")::int                          AS "insumos",
        COUNT(*) FILTER (
          WHERE i."activo" AND i."proveedorId" IS NOT NULL)::int         AS "conProveedor",
        COUNT(*) FILTER (
          WHERE i."activo" AND i."proveedorId" IS NULL)::int             AS "sinProveedor",
        COUNT(*) FILTER (WHERE ${BAJO_MINIMO_SQL})::int                  AS "bajoMinimo",
        COUNT(*) FILTER (
          WHERE ${BAJO_MINIMO_SQL} AND i."proveedorId" IS NULL)::int     AS "bajoMinimoSinProveedor",
        COALESCE(
          SUM(${COMPRA_SUGERIDA_SQL}) FILTER (WHERE ${BAJO_MINIMO_SQL}), 0
        )::float8                                                        AS "compraSugeridaTotal"
      FROM "Insumo" i
    `;

    const c = filas[0];
    return {
      /** Insumos activos. Los pausados no cuentan: estan fuera de juego. */
      insumos: c?.insumos ?? 0,
      conProveedor: c?.conProveedor ?? 0,
      sinProveedor: c?.sinProveedor ?? 0,
      bajoMinimo: c?.bajoMinimo ?? 0,
      /** Bajo minimo y sin nadie a quien pedirselo: el agujero de la barra. */
      bajoMinimoSinProveedor: c?.bajoMinimoSinProveedor ?? 0,
      /**
       * Suma de la compra sugerida de todo lo que esta bajo minimo. Es un
       * numero en unidades MEZCLADAS (kg + litros + unidades): sirve como
       * magnitud del pedido de compra, no como cantidad de una sola cosa.
       */
      compraSugeridaTotal: this.redondear(c?.compraSugeridaTotal ?? 0),
    };
  }

  /**
   * "Hay que llamar a": los proveedores activos con algo bajo minimo, con el
   * detalle de que encargarles.
   *
   * Viene como filas proveedor × insumo y se agrupa en Node. El corte por
   * `TOP_A_LLAMAR` se hace ANTES del join con los faltantes (en el CTE `top`),
   * asi que ningun proveedor sale con la lista de insumos cortada por la
   * mitad: entra entero o no entra.
   */
  private async hayQueLlamarA() {
    const filas = await this.prisma.$queryRaw<FilaALlamar[]>`
      WITH faltantes AS (
        SELECT i."proveedorId",
               i."id",
               i."nombre",
               i."unidadMedida",
               i."activo",
               i."stockActual"::float8          AS "stockActual",
               i."stockMinimo"::float8          AS "stockMinimo",
               (${ESTADO_SQL})                  AS "estado",
               (${COMPRA_SUGERIDA_SQL})::float8 AS "compraSugerida"
        FROM "Insumo" i
        WHERE ${BAJO_MINIMO_SQL}
          AND i."proveedorId" IS NOT NULL
      ),
      ranking AS (
        SELECT f."proveedorId",
               COUNT(*)::int                                        AS "bajoMinimo",
               COUNT(*) FILTER (WHERE f."stockActual" <= 0)::int    AS "sinStock",
               SUM(f."compraSugerida")::float8                      AS "compraSugerida"
        FROM faltantes f
        GROUP BY f."proveedorId"
      ),
      top AS (
        SELECT rk."proveedorId",
               rk."bajoMinimo",
               rk."sinStock",
               rk."compraSugerida",
               p."nombre"   AS "proveedorNombre",
               p."telefono" AS "proveedorTelefono"
        FROM ranking rk
        JOIN "Proveedor" p ON p."id" = rk."proveedorId"
        WHERE p."activo" = true
        ORDER BY rk."bajoMinimo" DESC, rk."sinStock" DESC, p."nombre" ASC
        LIMIT ${TOP_A_LLAMAR}
      )
      SELECT t."proveedorId",
             t."proveedorNombre",
             t."proveedorTelefono",
             t."bajoMinimo"     AS "provBajoMinimo",
             t."sinStock"       AS "provSinStock",
             t."compraSugerida" AS "provCompraSugerida",
             f."id",
             f."nombre",
             f."unidadMedida",
             f."activo",
             f."stockActual",
             f."stockMinimo",
             f."estado",
             f."compraSugerida"
      FROM top t
      JOIN faltantes f ON f."proveedorId" = t."proveedorId"
      ORDER BY t."bajoMinimo" DESC, t."sinStock" DESC, t."proveedorNombre" ASC,
               f."stockActual" ASC, f."nombre" ASC
    `;

    // El ORDER BY ya trae los faltantes de cada proveedor juntos y en orden;
    // aca solo se los agrupa, sin reordenar nada.
    const porProveedor = new Map<
      string,
      {
        id: string;
        nombre: string;
        telefono: string | null;
        bajoMinimo: number;
        sinStock: number;
        compraSugerida: number;
        items: ReturnType<AdminProveedoresService['componerInsumo']>[];
      }
    >();

    for (const fila of filas) {
      let entrada = porProveedor.get(fila.proveedorId);
      if (!entrada) {
        entrada = {
          id: fila.proveedorId,
          nombre: fila.proveedorNombre,
          telefono: fila.proveedorTelefono,
          bajoMinimo: fila.provBajoMinimo,
          sinStock: fila.provSinStock,
          compraSugerida: this.redondear(Number(fila.provCompraSugerida)),
          items: [],
        };
        porProveedor.set(fila.proveedorId, entrada);
      }
      entrada.items.push(this.componerInsumo(fila));
    }

    return [...porProveedor.values()];
  }

  /** "Quien trae mas": los activos con mas insumos colgados. */
  private async quienTraeMas() {
    const filas = await this.prisma.$queryRaw<
      Array<{ id: string; nombre: string; insumos: number }>
    >`
      WITH agg AS (${this.cteAgregados()})
      SELECT p."id",
             p."nombre",
             COALESCE(a."insumos", 0)::int AS "insumos"
      FROM "Proveedor" p
      LEFT JOIN agg a ON a."proveedorId" = p."id"
      WHERE p."activo" = true
        AND COALESCE(a."insumos", 0) > 0
      ORDER BY "insumos" DESC, p."nombre" ASC, p."id" ASC
      LIMIT ${TOP_RANKING}
    `;

    return filas;
  }

  // ------------------------------------------------------------- detalle

  async detalle(id: string) {
    const proveedor = await this.prisma.proveedor.findUnique({
      where: { id },
      select: {
        id: true,
        nombre: true,
        telefono: true,
        email: true,
        notas: true,
        activo: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!proveedor) throw new NotFoundException('Proveedor no encontrado');

    const [insumos, reposicion] = await Promise.all([
      this.insumosDelProveedor(id),
      this.ultimaReposicionDe(id),
    ]);

    const items = insumos.map((fila) => this.componerInsumo(fila));

    /**
     * El pedido sugerido sale de los insumos que YA se trajeron, no de otra
     * query: asi no puede pasar que la lista muestre un insumo en verde y el
     * pedido lo incluya igual. Un insumo pausado nunca entra (su estado es
     * PAUSADO, no BAJO), que es lo mismo que hace el header de Insumos.
     */
    const aComprar = items.filter(
      (item) => item.estado === 'BAJO' || item.estado === 'SIN_STOCK',
    );

    return {
      ...proveedor,

      resumen: {
        insumos: items.length,
        insumosActivos: items.filter((item) => item.activo).length,
        bajoMinimo: aComprar.length,
        sinStock: aComprar.filter((item) => item.estado === 'SIN_STOCK').length,
        compraSugerida: this.redondear(
          aComprar.reduce((total, item) => total + item.compraSugerida, 0),
        ),
      },

      ultimaReposicion: reposicion,

      /** Todos los insumos vinculados, los pausados incluidos, mas critico primero. */
      insumos: items,

      pedidoSugerido: {
        items: aComprar.map((item) => ({
          id: item.id,
          nombre: item.nombre,
          unidadMedida: item.unidadMedida,
          stockActual: item.stockActual,
          stockMinimo: item.stockMinimo,
          comprar: item.compraSugerida,
        })),
        totalItems: aComprar.length,
        /**
         * El texto ya armado para el boton "copiar pedido sugerido". Se arma
         * aca y no en el navegador para que lo que se copia y lo que se ve en
         * pantalla salgan del mismo lugar.
         */
        texto: aComprar
          .map(
            (item) =>
              `${item.nombre}: ${item.compraSugerida} ${item.unidadMedida}`,
          )
          .join('\n'),
      },
    };
  }

  /** Los insumos de un proveedor, mas critico primero. */
  private insumosDelProveedor(id: string) {
    return this.prisma.$queryRaw<FilaInsumo[]>`
      SELECT i."id",
             i."nombre",
             i."unidadMedida",
             i."activo",
             i."stockActual"::float8          AS "stockActual",
             i."stockMinimo"::float8          AS "stockMinimo",
             (${ESTADO_SQL})                  AS "estado",
             (${COMPRA_SUGERIDA_SQL})::float8 AS "compraSugerida"
      FROM "Insumo" i
      WHERE i."proveedorId" = ${id}
      -- Cuanto le queda EN PROPORCION a su propio minimo, igual que el orden
      -- por defecto de Insumos: uno con 3 de 8 esta peor que uno con 20 de 60.
      ORDER BY (i."stockActual" / GREATEST(i."stockMinimo", 1)) ASC,
               i."nombre" ASC, i."id" ASC
    `;
  }

  /** La ultima reposicion de UN proveedor. Ver `REPOSICION_SQL`. */
  private async ultimaReposicionDe(id: string) {
    const filas = await this.prisma.$queryRaw<
      Array<{ fecha: Date; cantidad: number; insumo: string }>
    >`
      SELECT m."createdAt"        AS "fecha",
             m."cantidad"::float8 AS "cantidad",
             i."nombre"           AS "insumo"
      FROM "StockMovimiento" m
      JOIN "Insumo" i ON i."id" = m."insumoId"
      WHERE ${REPOSICION_SQL}
        AND i."proveedorId" = ${id}
      ORDER BY m."createdAt" DESC
      LIMIT 1
    `;

    return this.componerReposicion(
      filas[0]?.fecha ?? null,
      filas[0]?.cantidad ?? null,
      filas[0]?.insumo ?? null,
    );
  }

  // ------------------------------------------------------------- escritura

  async crear(dto: CrearProveedorDto) {
    // El `@Transform` del DTO ya recorta, pero el service esta exportado y la
    // unicidad del nombre no puede depender de que quien llame haya pasado por
    // el ValidationPipe: " Norte " y "Norte" tienen que chocar igual.
    const nombre = dto.nombre.trim();
    await this.rechazarNombreRepetido(nombre);

    return this.enviarAPrisma(() =>
      this.prisma.proveedor.create({
        data: {
          nombre,
          telefono: dto.telefono ?? null,
          email: dto.email ?? null,
          notas: dto.notas ?? null,
          activo: true,
        },
      }),
    );
  }

  /**
   * Edicion de los datos de contacto.
   *
   * `activo` NO se toca por aca a proposito: archivar y reactivar son dos
   * endpoints propios. Guardar el form de la ficha no tiene por que poder dar
   * de baja a un proveedor de refilon.
   *
   * Un campo en `null` (el input vacio) BORRA el dato; un campo ausente lo
   * deja como estaba. Es la diferencia que hace `TextoOpcional` en el DTO.
   */
  async editar(id: string, dto: EditarProveedorDto) {
    await this.ensureExists(id);

    const nombre = dto.nombre?.trim();
    if (nombre !== undefined) {
      await this.rechazarNombreRepetido(nombre, id);
    }

    return this.enviarAPrisma(() =>
      this.prisma.proveedor.update({
        where: { id },
        data: {
          nombre,
          telefono: dto.telefono,
          email: dto.email,
          notas: dto.notas,
        },
      }),
    );
  }

  /**
   * Soft-delete. NO borra ni desasigna nada.
   *
   * Los insumos que lo tenian lo conservan: perder a quien se le compraba cada
   * insumo por dar de baja al proveedor seria destruir informacion que despues
   * no se puede reconstruir. Archivado solo significa que deja de ofrecerse
   * para asignar (ver `AdminInsumosService.proveedoresConConteo`) y que sale
   * de las tarjetas del header.
   */
  async archivar(id: string) {
    await this.ensureExists(id);

    return this.prisma.proveedor.update({
      where: { id },
      data: { activo: false },
    });
  }

  async reactivar(id: string) {
    await this.ensureExists(id);

    return this.prisma.proveedor.update({
      where: { id },
      data: { activo: true },
    });
  }

  // ------------------------------------------------------------- helpers

  /**
   * `nombre` es UNIQUE en la base, asi que sin esto un duplicado sale como
   * P2002 sin atrapar y el filtro global lo convierte en un 500 "Internal
   * server error" que no le dice nada a nadie.
   *
   * La comparacion es case-insensitive aunque el indice no lo sea: "Lacteos
   * SR" y "lacteos sr" son el mismo proveedor para el que carga, y dejar que
   * convivan ensucia el selector de Insumos para siempre.
   *
   * Si el que choca esta archivado se dice explicitamente: es el pozo clasico
   * del soft-delete, alguien intenta dar de alta algo que ya existe pero no ve
   * en la lista porque el filtro por defecto son solo los activos.
   */
  private async rechazarNombreRepetido(nombre: string, ignorarId?: string) {
    const choque = await this.prisma.proveedor.findFirst({
      where: {
        nombre: { equals: nombre, mode: 'insensitive' },
        ...(ignorarId ? { id: { not: ignorarId } } : {}),
      },
      select: { id: true, nombre: true, activo: true },
    });

    if (!choque) return;

    throw new ConflictException(
      choque.activo
        ? `Ya hay un proveedor que se llama "${choque.nombre}"`
        : `"${choque.nombre}" ya existe pero esta archivado. Reactivalo en vez de crearlo de nuevo.`,
    );
  }

  /**
   * Red de seguridad para el UNIQUE de `nombre`.
   *
   * `rechazarNombreRepetido` atrapa el caso normal, pero es un check-then-act:
   * dos altas simultaneas con el mismo nombre pasan las dos por el findFirst y
   * la segunda choca contra el indice. Sin esto, ese choque sale como P2002 sin
   * atrapar y el filtro global lo convierte en un 500 "Internal server error".
   */
  private async enviarAPrisma<T>(operacion: () => Promise<T>): Promise<T> {
    try {
      return await operacion();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ya hay un proveedor con ese nombre');
      }
      throw error;
    }
  }

  private async ensureExists(id: string) {
    const existe = await this.prisma.proveedor.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Proveedor no encontrado');
  }

  /** Fila cruda → item del listado, con lo derivado ya resuelto. */
  private componerItem(fila: FilaProveedor) {
    return {
      id: fila.id,
      nombre: fila.nombre,
      telefono: fila.telefono,
      email: fila.email,
      notas: fila.notas,
      activo: fila.activo,

      /** Todos los insumos que le cuelgan, pausados incluidos. */
      insumos: fila.insumos,
      /** Solo los que estan en juego. Es contra este que se leen los de abajo. */
      insumosActivos: fila.insumosActivos,
      bajoMinimo: fila.bajoMinimo,
      sinStock: fila.sinStock,
      /** Cuanto habria que comprarle en total. Unidades MEZCLADAS. */
      compraSugerida: this.redondear(Number(fila.compraSugerida)),

      ultimaReposicion: this.componerReposicion(
        fila.ultimaReposicionFecha,
        fila.ultimaReposicionCantidad,
        fila.ultimaReposicionInsumo,
      ),
    };
  }

  /** Fila cruda → insumo de la pantalla. */
  private componerInsumo(fila: FilaInsumo) {
    return {
      id: fila.id,
      nombre: fila.nombre,
      unidadMedida: fila.unidadMedida,
      activo: fila.activo,
      stockActual: this.redondear(Number(fila.stockActual)),
      stockMinimo: this.redondear(Number(fila.stockMinimo)),
      estado: fila.estado,
      /** Lo que falta para volver al doble del minimo. 0 = no hay que comprar. */
      compraSugerida: this.redondear(Number(fila.compraSugerida)),
    };
  }

  /**
   * `null` cuando no hay ninguna: no es "hace mucho", es que no hay con que
   * contestar la pregunta. El front tiene que poder distinguir los dos casos,
   * asi que no se inventa una fecha ni un 0.
   */
  private componerReposicion(
    fecha: Date | null,
    cantidad: number | null,
    insumo: string | null,
  ) {
    if (!fecha) return null;

    return {
      fecha: fecha.toISOString(),
      cantidad: this.redondear(Number(cantidad ?? 0)),
      insumo,
    };
  }

  /**
   * Dos decimales. El stock es Float y las sumas sacan colas de punto
   * flotante (`3.0000000000000004`) que no aportan nada en pantalla.
   */
  private redondear(valor: number): number {
    if (!Number.isFinite(valor)) return 0;
    return Math.round(valor * 100) / 100;
  }
}
