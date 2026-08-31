import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EstadoPedido, Prisma, TipoPedido } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  ZONA_HORARIA_NEGOCIO,
  claveFecha,
  codigoPedido,
  diasEnRango,
  finDelDia,
  inicioDelDia,
  inicioVentanaDias,
  parseFechaLocal,
} from '../common/helpers/fecha.helper';
import {
  AdminInsumosQueryDto,
  DIAS_CONSUMO_POR_DEFECTO,
  DisponibilidadInsumo,
  EstadoStock,
  OrdenInsumos,
  PAGE_SIZE_MAXIMO,
  PAGE_SIZE_POR_DEFECTO,
  SIN_PROVEEDOR,
} from './dto/admin-insumos-query.dto';
import {
  LIMITE_MOVIMIENTOS_MAXIMO,
  LIMITE_MOVIMIENTOS_POR_DEFECTO,
} from './dto/movimientos-query.dto';
import { ReporteConsumoQueryDto } from './dto/reporte-consumo-query.dto';
import {
  COMPRA_SUGERIDA_SQL,
  ESTADO_SQL,
  type EstadoInsumo,
} from './stock.sql';

/**
 * Estado derivado de un insumo. Se define en `stock.sql` junto a la expresion
 * SQL que lo calcula; se re-exporta aca para no romper lo que ya lo importaba
 * desde este archivo.
 */
export type { EstadoInsumo };

/** Una fila de la pagina, tal como sale del `$queryRaw`. */
interface FilaListado {
  id: string;
  nombre: string;
  stockActual: number;
  stockMinimo: number;
  unidadMedida: string;
  activo: boolean;
  proveedorId: string | null;
  proveedorNombre: string | null;
  estado: EstadoInsumo;
  compraSugerida: number;
  consumido: number;
  movimientos: number;
}

/** Una fila del bloque "se agotan primero". */
interface FilaAgotan {
  id: string;
  nombre: string;
  unidadMedida: string;
  stockActual: number;
  estado: EstadoInsumo;
  proveedorNombre: string | null;
  consumido: number;
}

/**
 * El pedido que origino un movimiento, tal como lo muestra el historial.
 * `tipo` y `estado` son nullables porque un pedido borrado deja el movimiento
 * en pie: se sigue mostrando el codigo aunque no haya nada mas que contar.
 */
export interface PedidoDeMovimiento {
  id: string;
  codigo: string;
  tipo: TipoPedido | null;
  estado: EstadoPedido | null;
}

interface Rango {
  inicio: Date;
  fin: Date;
}

/** Cuantos insumos entran en el bloque "se agotan primero" del header. */
const TOP_SE_AGOTAN = 5;

/** Cuantos insumos devuelve el reporte de consumo si no se pide otra cosa. */
const LIMITE_REPORTE_POR_DEFECTO = 20;

/** Ventana del reporte de consumo si no vienen ni `dias` ni `desde`/`hasta`. */
const DIAS_REPORTE_POR_DEFECTO = 7;

/**
 * Los dos tipos de movimiento que mueven la aguja del consumo.
 *
 * `AJUSTE_MANUAL` queda afuera a proposito: reponer una compra o corregir un
 * recuento no es consumir. Ver la nota de `cteConsumo`.
 */
const TIPOS_DE_CONSUMO = Prisma.sql`('DESCUENTO_PEDIDO', 'REPOSICION')`;

/**
 * ORDER BY por cada orden soportado.
 *
 * Se arma como SQL literal, asi que la unica entrada posible es el enum del
 * DTO (el ValidationPipe rechaza cualquier otra cosa antes de llegar aca).
 * Todos terminan en `i."id"` para que la paginacion sea estable: sin un
 * desempate unico, dos insumos con el mismo nombre pueden intercambiarse entre
 * paginas y aparecer repetidos o faltar.
 */
const ORDEN_SQL: Record<OrdenInsumos, Prisma.Sql> = {
  // Cuanto le queda EN PROPORCION a su propio minimo. Un insumo con 3 de 8
  // esta peor que uno con 20 de 60, aunque tenga menos unidades encima.
  [OrdenInsumos.POR_REPONER]: Prisma.sql`
    (i."stockActual" / GREATEST(i."stockMinimo", 1)) ASC, i."nombre" ASC, i."id" ASC
  `,
  [OrdenInsumos.CONSUMO]: Prisma.sql`
    COALESCE(c.consumido, 0) DESC, i."nombre" ASC, i."id" ASC
  `,
  [OrdenInsumos.ALFABETICO]: Prisma.sql`i."nombre" ASC, i."id" ASC`,
  [OrdenInsumos.STOCK_ASC]: Prisma.sql`i."stockActual" ASC, i."nombre" ASC, i."id" ASC`,
  [OrdenInsumos.STOCK_DESC]: Prisma.sql`i."stockActual" DESC, i."nombre" ASC, i."id" ASC`,
};

/**
 * Toda la pantalla de Insumos/Stock del panel en una sola request.
 *
 * Mismo criterio que /admin/home, /admin/estadisticas y /admin/productos: el
 * front vive en Vercel y la API en Hetzner, cada fetch server-side es un round
 * trip, y ningun total se calcula trayendo filas. La busqueda, los filtros, el
 * orden (incluido "por consumo", que ordena por un agregado de otra tabla) y
 * la paginacion los resuelve Postgres; lo unico que viaja son las filas de la
 * pagina pedida.
 */
@Injectable()
export class AdminInsumosService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------- listado

  async listar(query: AdminInsumosQueryDto, ahora: Date = new Date()) {
    const page = query.page ?? 1;
    const pageSize = Math.min(
      query.pageSize ?? PAGE_SIZE_POR_DEFECTO,
      PAGE_SIZE_MAXIMO,
    );
    const orden = query.orden ?? OrdenInsumos.POR_REPONER;
    const estado = query.estado ?? EstadoStock.TODOS;
    const disponibilidad = query.disponibilidad ?? DisponibilidadInsumo.ACTIVOS;
    const dias = query.dias ?? DIAS_CONSUMO_POR_DEFECTO;
    const offset = (page - 1) * pageSize;

    const ventana: Rango = {
      inicio: inicioVentanaDias(dias, ahora),
      fin: finDelDia(ahora),
    };

    const where = this.armarWhere(query, estado, disponibilidad);
    const consumo = this.cteConsumo(ventana);

    const [filas, total, stats, agotan, proveedores] = await Promise.all([
      this.paginaDeInsumos(consumo, where, orden, pageSize, offset),
      this.contarFiltrados(where),
      this.statsDelHeader(ventana, dias),
      this.seAgotanPrimero(consumo),
      this.proveedoresConConteo(),
    ]);

    return {
      stats,

      items: filas.map((fila) => this.componerItem(fila, dias)),

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
        proveedorId: query.proveedorId ?? null,
        orden,
      },

      /**
       * Ventana sobre la que se midio el consumo de `items`, de `seAgotan` y
       * del consumo del header. No afecta al resto de los numeros: el stock
       * es el de ahora, no el del final de la ventana.
       */
      ventana: {
        dias,
        desde: claveFecha(ventana.inicio),
        hasta: claveFecha(ventana.fin),
        zonaHoraria: ZONA_HORARIA_NEGOCIO,
      },

      /**
       * Los primeros en quedarse sin nada al ritmo actual. Es el unico bloque
       * que cruza stock con consumo, y por eso no se puede derivar de `items`,
       * que esta paginado y filtrado.
       */
      seAgotan: agotan.map((fila) => this.componerAgotan(fila, dias)),

      /**
       * Para el selector del form y el filtro por proveedor, asi la pantalla
       * no necesita un fetch aparte. El conteo incluye insumos pausados: es
       * cuantos insumos le cuelgan al proveedor, no cuantos estan en juego.
       */
      proveedores,
    };
  }

  /**
   * Consumo por insumo dentro de la ventana, como CTE.
   *
   * NETO, no bruto: se suman los DESCUENTO_PEDIDO y se les restan las
   * REPOSICION. El unico lugar que escribe REPOSICION es la cancelacion de un
   * pedido (`PedidosService.cancelar`), asi que netearlas es lo correcto: la
   * mercaderia de un pedido cancelado volvio al deposito y nunca se consumio.
   * Reponer una compra a mano entra como AJUSTE_MANUAL y queda afuera de los
   * dos lados, que tambien es lo correcto: comprar no es consumir.
   *
   * `cantidad` ya viene firmada en la tabla (negativa si se descontó), asi que
   * el signo sale de invertir la suma y no de un ABS que lo asuma.
   */
  private cteConsumo(ventana: Rango): Prisma.Sql {
    return Prisma.sql`
      SELECT "insumoId" AS id,
             SUM(-"cantidad")::float8 AS consumido,
             COUNT(*)::int            AS movimientos
      FROM "StockMovimiento"
      WHERE "insumoId" IS NOT NULL
        AND "tipo" IN ${TIPOS_DE_CONSUMO}
        AND "createdAt" >= ${ventana.inicio}
        AND "createdAt" <= ${ventana.fin}
      GROUP BY "insumoId"
    `;
  }

  /** Filtros del listado. Todos los valores viajan parametrizados. */
  private armarWhere(
    query: AdminInsumosQueryDto,
    estado: EstadoStock,
    disponibilidad: DisponibilidadInsumo,
  ): Prisma.Sql {
    const condiciones: Prisma.Sql[] = [];

    if (disponibilidad === DisponibilidadInsumo.ACTIVOS) {
      condiciones.push(Prisma.sql`i."activo" = true`);
    } else if (disponibilidad === DisponibilidadInsumo.PAUSADOS) {
      condiciones.push(Prisma.sql`i."activo" = false`);
    }

    // El estado de stock se compara contra el minimo DEL INSUMO. Es el cambio
    // de criterio de esta seccion: hasta ahora el badge del POS se pintaba
    // contra un umbral global unico para todo el deposito.
    if (estado === EstadoStock.SIN_STOCK) {
      condiciones.push(Prisma.sql`i."stockActual" <= 0`);
    } else if (estado === EstadoStock.BAJO) {
      condiciones.push(
        Prisma.sql`i."stockActual" > 0 AND i."stockActual" < i."stockMinimo"`,
      );
    } else if (estado === EstadoStock.POR_REPONER) {
      condiciones.push(Prisma.sql`i."stockActual" < i."stockMinimo"`);
    } else if (estado === EstadoStock.OK) {
      condiciones.push(
        Prisma.sql`i."stockActual" > 0 AND i."stockActual" >= i."stockMinimo"`,
      );
    }

    if (query.proveedorId === SIN_PROVEEDOR) {
      condiciones.push(Prisma.sql`i."proveedorId" IS NULL`);
    } else if (query.proveedorId) {
      condiciones.push(Prisma.sql`i."proveedorId" = ${query.proveedorId}`);
    }

    const texto = query.q?.trim();
    if (texto) {
      // Los comodines del ILIKE se escapan: si alguien busca "50%" tiene que
      // buscar ese texto, no "50 seguido de cualquier cosa".
      const patron = `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      condiciones.push(Prisma.sql`i."nombre" ILIKE ${patron}`);
    }

    if (condiciones.length === 0) return Prisma.empty;
    return Prisma.sql`WHERE ${Prisma.join(condiciones, ' AND ')}`;
  }

  /** La pagina pedida, ya ordenada, derivada y recortada por Postgres. */
  private paginaDeInsumos(
    consumo: Prisma.Sql,
    where: Prisma.Sql,
    orden: OrdenInsumos,
    pageSize: number,
    offset: number,
  ) {
    return this.prisma.$queryRaw<FilaListado[]>`
      WITH consumo AS (${consumo})
      SELECT i."id",
             i."nombre",
             i."stockActual"::float8          AS "stockActual",
             i."stockMinimo"::float8          AS "stockMinimo",
             i."unidadMedida",
             i."activo",
             i."proveedorId",
             pr."nombre"                      AS "proveedorNombre",
             (${ESTADO_SQL})                  AS "estado",
             (${COMPRA_SUGERIDA_SQL})::float8 AS "compraSugerida",
             COALESCE(c.consumido, 0)::float8 AS "consumido",
             COALESCE(c.movimientos, 0)::int  AS "movimientos"
      FROM "Insumo" i
      LEFT JOIN consumo c      ON c.id = i."id"
      LEFT JOIN "Proveedor" pr ON pr."id" = i."proveedorId"
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
      FROM "Insumo" i
      ${where}
    `;
    return filas[0]?.total ?? 0;
  }

  /**
   * Las tarjetas del header: una sola pasada sobre "Insumo" mas una sobre el
   * ledger.
   *
   * Son del deposito entero, NO de lo filtrado: describen el estado del
   * negocio, no el de la busqueda. Los conteos por estado miran solo activos
   * (un insumo pausado no esta "bajo minimo", esta fuera de juego), y por eso
   * ok + bajo + sinStock da exactamente `activos`.
   */
  private async statsDelHeader(ventana: Rango, dias: number) {
    const [conteos, consumo] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          total: number;
          activos: number;
          pausados: number;
          ok: number;
          bajo: number;
          sinStock: number;
          porReponer: number;
          sinProveedor: number;
          compraSugeridaTotal: number;
          proveedoresAContactar: number;
        }>
      >`
        SELECT
          COUNT(*)::int                                                     AS "total",
          COUNT(*) FILTER (WHERE i."activo")::int                           AS "activos",
          COUNT(*) FILTER (WHERE NOT i."activo")::int                       AS "pausados",
          COUNT(*) FILTER (
            WHERE i."activo" AND i."stockActual" > 0
              AND i."stockActual" >= i."stockMinimo")::int                  AS "ok",
          COUNT(*) FILTER (
            WHERE i."activo" AND i."stockActual" > 0
              AND i."stockActual" < i."stockMinimo")::int                   AS "bajo",
          COUNT(*) FILTER (WHERE i."activo" AND i."stockActual" <= 0)::int  AS "sinStock",
          COUNT(*) FILTER (
            WHERE i."activo" AND i."stockActual" < i."stockMinimo")::int    AS "porReponer",
          COUNT(*) FILTER (
            WHERE i."activo" AND i."proveedorId" IS NULL)::int              AS "sinProveedor",
          COALESCE(
            SUM(${COMPRA_SUGERIDA_SQL}) FILTER (WHERE i."activo"), 0
          )::float8                                                         AS "compraSugeridaTotal",
          COUNT(DISTINCT i."proveedorId") FILTER (
            WHERE i."activo" AND i."stockActual" < i."stockMinimo")::int    AS "proveedoresAContactar"
        FROM "Insumo" i
      `,

      this.prisma.$queryRaw<
        Array<{
          consumido: number;
          descontado: number;
          repuesto: number;
          insumos: number;
        }>
      >`
        SELECT COALESCE(SUM(-"cantidad"), 0)::float8 AS "consumido",
               COALESCE(SUM(-"cantidad") FILTER (WHERE "tipo" = 'DESCUENTO_PEDIDO'), 0)::float8 AS "descontado",
               COALESCE(SUM("cantidad")  FILTER (WHERE "tipo" = 'REPOSICION'), 0)::float8       AS "repuesto",
               COUNT(DISTINCT "insumoId")::int       AS "insumos"
        FROM "StockMovimiento"
        WHERE "insumoId" IS NOT NULL
          AND "tipo" IN ${TIPOS_DE_CONSUMO}
          AND "createdAt" >= ${ventana.inicio}
          AND "createdAt" <= ${ventana.fin}
      `,
    ]);

    const c = conteos[0];
    const consumido = Number(consumo[0]?.consumido ?? 0);

    return {
      total: c?.total ?? 0,
      activos: c?.activos ?? 0,
      pausados: c?.pausados ?? 0,
      ok: c?.ok ?? 0,
      bajo: c?.bajo ?? 0,
      sinStock: c?.sinStock ?? 0,
      /** bajo + sinStock: cuantos insumos hay que encargar. */
      porReponer: c?.porReponer ?? 0,
      sinProveedor: c?.sinProveedor ?? 0,
      /**
       * Suma de la compra sugerida de todos los activos. Es un numero en
       * unidades mezcladas (kg + litros + unidades): sirve como magnitud del
       * pedido de compra, no como cantidad de una sola cosa.
       */
      compraSugeridaTotal: this.redondear(c?.compraSugeridaTotal ?? 0),
      /** Cuantos proveedores distintos hay que contactar para reponer. */
      proveedoresAContactar: c?.proveedoresAContactar ?? 0,
      /**
       * Consumo NETO de la ventana. Puede dar NEGATIVO y no es un bug: si un
       * pedido se descontó antes de que arrancara la ventana y se canceló
       * adentro, la reposición cae dentro y el descuento no. Por eso van
       * también `descontado` y `repuesto`, que son los dos lados de la resta:
       * un total negativo tiene que poder explicarse sin abrir la base.
       */
      consumo: {
        total: this.redondear(consumido),
        diario: this.redondear(consumido / dias),
        descontado: this.redondear(Number(consumo[0]?.descontado ?? 0)),
        repuesto: this.redondear(Number(consumo[0]?.repuesto ?? 0)),
        insumosEnMovimiento: consumo[0]?.insumos ?? 0,
      },
    };
  }

  /**
   * Los que menos aguantan al ritmo de la ventana.
   *
   * Solo activos y solo con consumo > 0: un insumo que no se movio no tiene
   * "dias de aguante", tiene infinitos, y encabezaria el ranking para siempre.
   * El orden es por dias (stock / consumo diario) y lo resuelve SQL, para no
   * traerse el deposito entero a ordenarlo en Node.
   */
  private seAgotanPrimero(consumo: Prisma.Sql) {
    return this.prisma.$queryRaw<FilaAgotan[]>`
      WITH consumo AS (${consumo})
      SELECT i."id",
             i."nombre",
             i."unidadMedida",
             i."stockActual"::float8 AS "stockActual",
             (${ESTADO_SQL})         AS "estado",
             pr."nombre"             AS "proveedorNombre",
             c.consumido::float8     AS "consumido"
      FROM "Insumo" i
      JOIN consumo c           ON c.id = i."id"
      LEFT JOIN "Proveedor" pr ON pr."id" = i."proveedorId"
      WHERE i."activo" = true
        AND c.consumido > 0
      ORDER BY (i."stockActual" / c.consumido) ASC, i."nombre" ASC, i."id" ASC
      LIMIT ${TOP_SE_AGOTAN}
    `;
  }

  /**
   * Proveedores para el selector, con cuantos insumos le cuelgan a cada uno.
   *
   * SOLO ACTIVOS. Un proveedor archivado no tiene que poder elegirse en el
   * alta de un insumo: archivarlo es justamente decir que no se le compra mas.
   * Los insumos que ya lo tenian lo conservan (archivar no desasigna nada), y
   * en la fila del listado se sigue viendo su nombre, que sale del JOIN y no
   * de esta lista.
   *
   * El costo es que el filtro por proveedor deja de ofrecer a los archivados:
   * para ver que insumos siguen colgando de uno, el lugar es la seccion de
   * Proveedores, que si los lista con `estado=ARCHIVADOS`.
   */
  private async proveedoresConConteo() {
    const filas = await this.prisma.proveedor.findMany({
      where: { activo: true },
      select: {
        id: true,
        nombre: true,
        activo: true,
        telefono: true,
        _count: { select: { insumos: true } },
      },
      orderBy: { nombre: 'asc' },
    });

    return filas.map(({ _count, ...proveedor }) => ({
      ...proveedor,
      insumos: _count.insumos,
    }));
  }

  /** Fila cruda → item de la pantalla, con lo derivado ya resuelto. */
  private componerItem(fila: FilaListado, dias: number) {
    const stockActual = Number(fila.stockActual);
    const consumido = Number(fila.consumido);
    const consumoDiario = consumido / dias;

    return {
      id: fila.id,
      nombre: fila.nombre,
      stockActual,
      stockMinimo: Number(fila.stockMinimo),
      unidadMedida: fila.unidadMedida,
      activo: fila.activo,

      proveedor: fila.proveedorId
        ? { id: fila.proveedorId, nombre: fila.proveedorNombre ?? '' }
        : null,

      estado: fila.estado,
      compraSugerida: this.redondear(Number(fila.compraSugerida)),

      consumo: {
        /** Consumo NETO de la ventana: descuentos menos reposiciones. */
        total: this.redondear(consumido),
        diario: this.redondear(consumoDiario),
        movimientos: fila.movimientos,
        /**
         * Cuantos dias aguanta al ritmo de la ventana. `null` cuando no hubo
         * consumo: no es "infinitos dias", es "no hay con que estimarlo".
         */
        diasDeAguante:
          consumoDiario > 0
            ? this.redondear(stockActual / consumoDiario)
            : null,
      },
    };
  }

  /** Fila cruda del bloque "se agotan primero" → item de la pantalla. */
  private componerAgotan(fila: FilaAgotan, dias: number) {
    const stockActual = Number(fila.stockActual);
    const consumoDiario = Number(fila.consumido) / dias;

    return {
      id: fila.id,
      nombre: fila.nombre,
      unidadMedida: fila.unidadMedida,
      stockActual,
      estado: fila.estado,
      proveedor: fila.proveedorNombre,
      consumoDiario: this.redondear(consumoDiario),
      diasDeAguante: this.redondear(stockActual / consumoDiario),
    };
  }

  // ----------------------------------------------------------- historial

  /**
   * El modal de historial de un insumo: su ficha arriba y sus movimientos
   * abajo.
   *
   * Incluye las REPOSICION de cancelacion de pedido: el ledger no se filtra
   * por tipo, y la cancelacion escribe su fila igual que el descuento. El
   * `pedidoId` de StockMovimiento es un String suelto, sin relacion declarada
   * en el schema, asi que los pedidos se resuelven en una segunda ola acotada
   * por `limit`.
   */
  async historial(insumoId: string, limitPedido?: number) {
    const limit = Math.min(
      limitPedido ?? LIMITE_MOVIMIENTOS_POR_DEFECTO,
      LIMITE_MOVIMIENTOS_MAXIMO,
    );

    const [insumo, movimientos, total] = await Promise.all([
      this.prisma.insumo.findUnique({
        where: { id: insumoId },
        select: {
          id: true,
          nombre: true,
          stockActual: true,
          stockMinimo: true,
          unidadMedida: true,
          activo: true,
          proveedor: { select: { id: true, nombre: true } },
        },
      }),
      this.prisma.stockMovimiento.findMany({
        where: { insumoId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          tipo: true,
          cantidad: true,
          stockAntes: true,
          stockDespues: true,
          pedidoId: true,
          motivo: true,
          userId: true,
          createdAt: true,
        },
      }),
      this.prisma.stockMovimiento.count({ where: { insumoId } }),
    ]);

    if (!insumo) throw new NotFoundException('Insumo no encontrado');

    const pedidos = await this.pedidosDe(movimientos);

    return {
      insumo: {
        id: insumo.id,
        nombre: insumo.nombre,
        stockActual: insumo.stockActual,
        stockMinimo: insumo.stockMinimo,
        unidadMedida: insumo.unidadMedida,
        activo: insumo.activo,
        proveedor: insumo.proveedor,
        estado: this.estadoDe(insumo),
        compraSugerida: this.redondear(
          Math.max(0, insumo.stockMinimo * 2 - insumo.stockActual),
        ),
      },

      movimientos: movimientos.map((m) => ({
        id: m.id,
        tipo: m.tipo,
        cantidad: m.cantidad,
        stockAntes: m.stockAntes,
        stockDespues: m.stockDespues,
        motivo: m.motivo,
        userId: m.userId,
        createdAt: m.createdAt,
        pedido: m.pedidoId
          ? (pedidos.get(m.pedidoId) ?? {
              // El pedido pudo haberse borrado; el movimiento sigue siendo
              // cierto, asi que se muestra el codigo igual.
              id: m.pedidoId,
              codigo: codigoPedido(m.pedidoId),
              tipo: null,
              estado: null,
            })
          : null,
      })),

      /** Cuantos movimientos tiene en total, para saber si `limit` recorto. */
      total,
      limit,
    };
  }

  /** Los pedidos citados por una tanda de movimientos, indexados por id. */
  private async pedidosDe(movimientos: Array<{ pedidoId: string | null }>) {
    const ids = [
      ...new Set(
        movimientos
          .map((m) => m.pedidoId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    if (ids.length === 0) return new Map<string, PedidoDeMovimiento>();

    const pedidos = await this.prisma.pedido.findMany({
      where: { id: { in: ids } },
      select: { id: true, tipo: true, estado: true },
    });

    return new Map<string, PedidoDeMovimiento>(
      pedidos.map((p) => [
        p.id,
        {
          id: p.id,
          codigo: codigoPedido(p.id),
          tipo: p.tipo,
          estado: p.estado,
        },
      ]),
    );
  }

  // ------------------------------------------------------------- reporte

  /**
   * Consumo por insumo dentro de un rango, con su serie diaria.
   *
   * Todo agregado en Postgres: el service recibe una fila por insumo y una
   * fila por (insumo, dia), nunca los movimientos crudos. Sobre un mes de
   * operacion eso es la diferencia entre unas decenas de filas y varios miles.
   *
   * Doble `AT TIME ZONE` obligatorio en el corte por dia: `createdAt` es
   * `TIMESTAMP(3)` sin zona guardando UTC (convencion de Prisma), asi que se
   * lo reinterpreta como UTC y recien ahi se pasa a hora local. Sin eso, los
   * movimientos de la madrugada caerian en el dia anterior. El dia vuelve como
   * texto (`to_char`) y no como timestamp: `date_trunc` devuelve
   * `timestamp without time zone` y el driver lo hidrata como Date
   * interpretandolo en UTC, corriendo la clave un dia en un server en UTC-3.
   */
  async reporteConsumo(
    query: ReporteConsumoQueryDto,
    ahora: Date = new Date(),
  ) {
    const rango = this.resolverRango(query, ahora);
    const dias = diasEnRango(rango.inicio, rango.fin);
    const limite = query.limite ?? LIMITE_REPORTE_POR_DEFECTO;

    const [porInsumo, totales] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          insumoId: string;
          nombre: string;
          unidadMedida: string;
          activo: boolean;
          proveedorNombre: string | null;
          consumido: number;
          descontado: number;
          repuesto: number;
          movimientos: number;
        }>
      >`
        SELECT m."insumoId"               AS "insumoId",
               i."nombre",
               i."unidadMedida",
               i."activo",
               pr."nombre"                AS "proveedorNombre",
               SUM(-m."cantidad")::float8 AS "consumido",
               COALESCE(SUM(-m."cantidad") FILTER (WHERE m."tipo" = 'DESCUENTO_PEDIDO'), 0)::float8 AS "descontado",
               COALESCE(SUM(m."cantidad")  FILTER (WHERE m."tipo" = 'REPOSICION'), 0)::float8       AS "repuesto",
               COUNT(*)::int              AS "movimientos"
        FROM "StockMovimiento" m
        JOIN "Insumo" i          ON i."id" = m."insumoId"
        LEFT JOIN "Proveedor" pr ON pr."id" = i."proveedorId"
        WHERE m."tipo" IN ${TIPOS_DE_CONSUMO}
          AND m."createdAt" >= ${rango.inicio}
          AND m."createdAt" <= ${rango.fin}
        GROUP BY m."insumoId", i."nombre", i."unidadMedida", i."activo", pr."nombre"
        HAVING SUM(-m."cantidad") > 0
        ORDER BY "consumido" DESC, i."nombre" ASC
        LIMIT ${limite}
      `,

      this.prisma.$queryRaw<
        Array<{ consumido: number; insumos: number; movimientos: number }>
      >`
        SELECT COALESCE(SUM(-"cantidad"), 0)::float8 AS "consumido",
               COUNT(DISTINCT "insumoId")::int       AS "insumos",
               COUNT(*)::int                         AS "movimientos"
        FROM "StockMovimiento"
        WHERE "insumoId" IS NOT NULL
          AND "tipo" IN ${TIPOS_DE_CONSUMO}
          AND "createdAt" >= ${rango.inicio}
          AND "createdAt" <= ${rango.fin}
      `,
    ]);

    // La serie diaria, solo de los insumos que entraron al ranking: es lo unico
    // que la pantalla dibuja, y sin ese recorte esto crece con el deposito.
    const porDia = await this.consumoPorDia(
      rango,
      porInsumo.map((f) => f.insumoId),
    );

    const seriePorInsumo = new Map<
      string,
      Array<{ dia: string; consumido: number }>
    >();
    for (const fila of porDia) {
      const serie = seriePorInsumo.get(fila.insumoId) ?? [];
      serie.push({
        dia: fila.dia,
        consumido: this.redondear(Number(fila.consumido)),
      });
      seriePorInsumo.set(fila.insumoId, serie);
    }

    const totalConsumido = Number(totales[0]?.consumido ?? 0);

    return {
      rango: {
        desde: claveFecha(rango.inicio),
        hasta: claveFecha(rango.fin),
        dias,
        zonaHoraria: ZONA_HORARIA_NEGOCIO,
      },

      totales: {
        /** Consumo neto de TODOS los insumos, no solo de los del ranking. */
        consumido: this.redondear(totalConsumido),
        consumoDiario: this.redondear(totalConsumido / dias),
        insumosEnMovimiento: totales[0]?.insumos ?? 0,
        movimientos: totales[0]?.movimientos ?? 0,
      },

      items: porInsumo.map((fila) => {
        const consumido = Number(fila.consumido);

        return {
          insumoId: fila.insumoId,
          nombre: fila.nombre,
          unidadMedida: fila.unidadMedida,
          activo: fila.activo,
          proveedor: fila.proveedorNombre,
          consumido: this.redondear(consumido),
          consumoDiario: this.redondear(consumido / dias),
          /** Cuanto se descontó y cuanto volvio por cancelaciones. */
          descontado: this.redondear(Number(fila.descontado)),
          repuesto: this.redondear(Number(fila.repuesto)),
          movimientos: fila.movimientos,
          /**
           * Que porcentaje del consumo del periodo se llevo este insumo. Se
           * calcula contra el total GENERAL y no contra la suma del ranking:
           * si no, cualquier top N daria siempre 100%.
           */
          pctDelTotal: this.porcentaje(consumido, totalConsumido),
          porDia: seriePorInsumo.get(fila.insumoId) ?? [],
        };
      }),

      limite,
    };
  }

  /** Serie diaria de consumo para un puñado de insumos. */
  private consumoPorDia(rango: Rango, insumoIds: string[]) {
    if (insumoIds.length === 0) {
      return Promise.resolve(
        [] as Array<{ insumoId: string; dia: string; consumido: number }>,
      );
    }

    return this.prisma.$queryRaw<
      Array<{ insumoId: string; dia: string; consumido: number }>
    >`
      SELECT "insumoId" AS "insumoId",
             to_char(
               date_trunc(
                 'day',
                 ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${ZONA_HORARIA_NEGOCIO}
               ),
               'YYYY-MM-DD'
             ) AS "dia",
             SUM(-"cantidad")::float8 AS "consumido"
      FROM "StockMovimiento"
      WHERE "insumoId" IN (${Prisma.join(insumoIds)})
        AND "tipo" IN ${TIPOS_DE_CONSUMO}
        AND "createdAt" >= ${rango.inicio}
        AND "createdAt" <= ${rango.fin}
      GROUP BY "insumoId", "dia"
      ORDER BY "dia" ASC
    `;
  }

  /**
   * Mismo contrato de rango que el panel de Estadisticas: `dias=N` es una
   * ventana que termina hoy, y `desde`/`hasta` la pisa.
   */
  private resolverRango(query: ReporteConsumoQueryDto, ahora: Date): Rango {
    if (!query.desde && !query.hasta) {
      const dias = query.dias ?? DIAS_REPORTE_POR_DEFECTO;
      return { inicio: inicioVentanaDias(dias, ahora), fin: finDelDia(ahora) };
    }

    const textoDesde = query.desde ?? query.hasta!;
    const textoHasta = query.hasta ?? query.desde!;

    const desde = parseFechaLocal(textoDesde);
    const hasta = parseFechaLocal(textoHasta);

    // El DTO ya valida la forma; aca se cazan las fechas con forma valida pero
    // inexistentes, tipo 2026-02-31.
    if (!desde)
      throw new BadRequestException(`La fecha "${textoDesde}" no existe`);
    if (!hasta)
      throw new BadRequestException(`La fecha "${textoHasta}" no existe`);

    const inicio = inicioDelDia(desde);
    const fin = finDelDia(hasta);

    if (inicio.getTime() > fin.getTime()) {
      throw new BadRequestException(
        'El rango esta invertido: "desde" es posterior a "hasta"',
      );
    }

    return { inicio, fin };
  }

  // ------------------------------------------------------------- helpers

  /** El mismo CASE del SQL, para los caminos que no pasan por `$queryRaw`. */
  private estadoDe(insumo: {
    activo: boolean;
    stockActual: number;
    stockMinimo: number;
  }): EstadoInsumo {
    if (!insumo.activo) return 'PAUSADO';
    if (insumo.stockActual <= 0) return 'SIN_STOCK';
    if (insumo.stockActual < insumo.stockMinimo) return 'BAJO';
    return 'OK';
  }

  /**
   * Dos decimales. El stock es Float y las divisiones por dias sacan colas de
   * punto flotante (`3.0000000000000004`) que no aportan nada en pantalla.
   */
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
