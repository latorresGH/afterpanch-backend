import { Injectable } from '@nestjs/common';
import { EstadoPedido, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { claveFecha, inicioVentanaDias } from '../common/helpers/fecha.helper';
import {
  AdminProductosQueryDto,
  EstadoProductoFiltro,
  OrdenProductos,
  PAGE_SIZE_MAXIMO,
  PAGE_SIZE_POR_DEFECTO,
} from './dto/admin-productos-query.dto';
import { disponibilidadDe } from './disponibilidad';

/** Una fila de la pagina: el id del producto y sus ventas ya sumadas. */
interface FilaListado {
  id: string;
  unidades: number;
  facturado: number;
  lineas: number;
}

/** Extremos del ranking para las tarjetas del header. */
interface FilaExtremo {
  extremo: 'MAS' | 'MENOS';
  id: string;
  nombre: string;
  unidades: number;
}

/**
 * ORDER BY por cada orden soportado.
 *
 * Se arma como SQL literal, asi que la unica entrada posible es el enum del
 * DTO (el ValidationPipe rechaza cualquier otra cosa antes de llegar aca).
 * Todos terminan en `p."id"` para que la paginacion sea estable: sin un
 * desempate unico, dos productos con el mismo nombre o precio pueden
 * intercambiarse entre paginas y aparecer repetidos o faltar.
 */
const ORDEN_SQL: Record<OrdenProductos, Prisma.Sql> = {
  [OrdenProductos.ALFABETICO]: Prisma.sql`p."nombre" ASC, p."id" ASC`,
  [OrdenProductos.MAS_VENDIDOS]: Prisma.sql`COALESCE(v.unidades, 0) DESC, p."nombre" ASC, p."id" ASC`,
  [OrdenProductos.MENOS_VENDIDOS]: Prisma.sql`COALESCE(v.unidades, 0) ASC, p."nombre" ASC, p."id" ASC`,
  [OrdenProductos.PRECIO_ASC]: Prisma.sql`p."precio" ASC, p."nombre" ASC, p."id" ASC`,
  [OrdenProductos.PRECIO_DESC]: Prisma.sql`p."precio" DESC, p."nombre" ASC, p."id" ASC`,
};

/**
 * Toda la pantalla de Productos del panel en una sola request.
 *
 * Mismo criterio que /admin/home y /admin/estadisticas: el front vive en
 * Vercel y la API en Hetzner, cada fetch server-side es un round trip, y
 * ningun total se calcula trayendo filas. La busqueda, el filtro, el orden
 * (incluido "mas vendidos", que ordena por un agregado de otra tabla) y la
 * paginacion los resuelve Postgres; lo unico que viaja son las filas de la
 * pagina pedida.
 */
@Injectable()
export class AdminProductosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(query: AdminProductosQueryDto, ahora: Date = new Date()) {
    const page = query.page ?? 1;
    const pageSize = Math.min(
      query.pageSize ?? PAGE_SIZE_POR_DEFECTO,
      PAGE_SIZE_MAXIMO,
    );
    const orden = query.orden ?? OrdenProductos.ALFABETICO;
    const estado = query.estado ?? EstadoProductoFiltro.TODOS;
    const offset = (page - 1) * pageSize;

    // Sin `dias`, las ventas son el historico completo: en una carta, "el mas
    // vendido" se lee como el de siempre, no el de esta quincena.
    const desde = query.dias ? inicioVentanaDias(query.dias, ahora) : null;

    const where = this.armarWhere(query, estado);
    const ventas = this.cteVentas(desde);

    const [filas, total, conteos, extremos, categorias] = await Promise.all([
      this.paginaDeProductos(ventas, where, orden, pageSize, offset),
      this.contarFiltrados(where),
      this.conteosPorEstado(),
      this.extremosDeVenta(ventas),
      this.categoriasConConteo(),
    ]);

    const items = await this.hidratar(filas);

    return {
      stats: {
        total: conteos.total,
        disponibles: conteos.activos,
        pausados: conteos.pausados,
        masVendido: extremos.mas,
        menosVendido: extremos.menos,
      },

      items,

      paginacion: {
        page,
        pageSize,
        total,
        totalPaginas: Math.max(1, Math.ceil(total / pageSize)),
      },

      filtros: {
        q: query.q?.trim() || null,
        categoriaId: query.categoriaId ?? null,
        estado,
        orden,
      },

      /**
       * Ventana sobre la que se contaron las ventas de `items` y de los
       * extremos del header. `desde: null` = historico completo.
       */
      ventana: {
        dias: query.dias ?? null,
        desde: desde ? claveFecha(desde) : null,
      },

      /**
       * Para el selector de categoria, asi la pantalla no necesita un fetch
       * aparte. El conteo incluye pausados: es cuantos productos cuelgan de
       * la categoria, no cuantos se estan vendiendo.
       */
      categorias,
    };
  }

  /**
   * Ventas por producto: unidades, facturado y cantidad de lineas.
   *
   * Solo pedidos ENTREGADO, igual que el ranking de Estadisticas: un pedido
   * cancelado no es una venta. Sale como CTE para que el listado pueda
   * ordenar por estas columnas sin traerse nada a Node.
   */
  private cteVentas(desde: Date | null): Prisma.Sql {
    const filtroFecha = desde
      ? Prisma.sql`AND ped."createdAt" >= ${desde}`
      : Prisma.empty;

    return Prisma.sql`
      SELECT pd."productoId" AS id,
             SUM(pd."cantidad")::int      AS unidades,
             SUM(pd."subtotal")::float8   AS facturado,
             COUNT(*)::int                AS lineas
      FROM "PedidoDetalle" pd
      JOIN "Pedido" ped ON ped."id" = pd."pedidoId"
      WHERE ped."estado" = ${EstadoPedido.ENTREGADO}::"EstadoPedido"
        ${filtroFecha}
      GROUP BY pd."productoId"
    `;
  }

  /** Filtros del listado. Todos los valores viajan parametrizados. */
  private armarWhere(
    query: AdminProductosQueryDto,
    estado: EstadoProductoFiltro,
  ): Prisma.Sql {
    const condiciones: Prisma.Sql[] = [];

    if (estado === EstadoProductoFiltro.ACTIVOS) {
      condiciones.push(Prisma.sql`p."activo" = true`);
    } else if (estado === EstadoProductoFiltro.PAUSADOS) {
      condiciones.push(Prisma.sql`p."activo" = false`);
    }

    if (query.categoriaId) {
      condiciones.push(Prisma.sql`p."categoriaId" = ${query.categoriaId}`);
    }

    const texto = query.q?.trim();
    if (texto) {
      // Los comodines del ILIKE se escapan: si alguien busca "50%" tiene que
      // buscar ese texto, no "50 seguido de cualquier cosa".
      const patron = `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      condiciones.push(
        Prisma.sql`(p."nombre" ILIKE ${patron} OR COALESCE(p."descripcion", '') ILIKE ${patron})`,
      );
    }

    if (condiciones.length === 0) return Prisma.empty;
    return Prisma.sql`WHERE ${Prisma.join(condiciones, ' AND ')}`;
  }

  /** La pagina pedida, ya ordenada y recortada por Postgres. */
  private paginaDeProductos(
    ventas: Prisma.Sql,
    where: Prisma.Sql,
    orden: OrdenProductos,
    pageSize: number,
    offset: number,
  ) {
    return this.prisma.$queryRaw<FilaListado[]>`
      WITH ventas AS (${ventas})
      SELECT p."id",
             COALESCE(v.unidades, 0)::int    AS unidades,
             COALESCE(v.facturado, 0)::float8 AS facturado,
             COALESCE(v.lineas, 0)::int      AS lineas
      FROM "Producto" p
      LEFT JOIN ventas v ON v.id = p."id"
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
      FROM "Producto" p
      ${where}
    `;
    return filas[0]?.total ?? 0;
  }

  /**
   * Las tres tarjetas de conteo del header. Son del catalogo entero, no de lo
   * filtrado: describen el estado del negocio, no el de la busqueda.
   */
  private async conteosPorEstado() {
    const filas = await this.prisma.producto.groupBy({
      by: ['activo'],
      _count: { _all: true },
    });

    const activos = filas.find((f) => f.activo === true)?._count._all ?? 0;
    const pausados = filas.find((f) => f.activo === false)?._count._all ?? 0;

    return { activos, pausados, total: activos + pausados };
  }

  /**
   * La cuarta tarjeta: mas vendido y menos vendido, en una sola pasada.
   *
   * Se toma solo sobre productos activos y contando desde cero a los que nunca
   * se vendieron. Un producto pausado hace meses siempre ganaria el "menos
   * vendido" y no dice nada; entre los que estan a la venta, en cambio, el
   * cero es exactamente el dato que interesa.
   */
  private async extremosDeVenta(ventas: Prisma.Sql) {
    const filas = await this.prisma.$queryRaw<FilaExtremo[]>`
      WITH ventas AS (${ventas}),
      catalogo AS (
        SELECT p."id", p."nombre", COALESCE(v.unidades, 0)::int AS unidades
        FROM "Producto" p
        LEFT JOIN ventas v ON v.id = p."id"
        WHERE p."activo" = true
      )
      (SELECT 'MAS' AS extremo, id, nombre, unidades
         FROM catalogo ORDER BY unidades DESC, nombre ASC LIMIT 1)
      UNION ALL
      (SELECT 'MENOS' AS extremo, id, nombre, unidades
         FROM catalogo ORDER BY unidades ASC, nombre ASC LIMIT 1)
    `;

    const armar = (fila?: FilaExtremo) =>
      fila
        ? { productoId: fila.id, nombre: fila.nombre, unidades: fila.unidades }
        : null;

    return {
      mas: armar(filas.find((f) => f.extremo === 'MAS')),
      menos: armar(filas.find((f) => f.extremo === 'MENOS')),
    };
  }

  /** Categorias para el filtro, con cuantos productos cuelgan de cada una. */
  private async categoriasConConteo() {
    const filas = await this.prisma.categoria.findMany({
      select: {
        id: true,
        nombre: true,
        orden: true,
        activo: true,
        _count: { select: { productos: true } },
      },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    });

    return filas.map(({ _count, ...categoria }) => ({
      ...categoria,
      productos: _count.productos,
    }));
  }

  /**
   * Segunda ola: los datos del producto para los ids de la pagina.
   *
   * Va aparte del listado porque la receta es una relacion 1-N y traerla en el
   * mismo `$queryRaw` obligaria a agregarla a json a mano. Son como mucho
   * `pageSize` productos, y el orden lo impone la query de arriba: aca solo se
   * respeta.
   */
  private async hidratar(filas: FilaListado[]) {
    if (filas.length === 0) return [];

    const ids = filas.map((f) => f.id);

    const productos = await this.prisma.producto.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        nombre: true,
        precio: true,
        activo: true,
        esParaVenta: true,
        descripcion: true,
        imagenUrl: true,
        codigo: true,
        tiempoPreparacionMin: true,
        categoriaId: true,
        categoria: { select: { id: true, nombre: true, orden: true } },
        receta: {
          select: {
            insumoId: true,
            cantidad: true,
            insumo: {
              select: {
                id: true,
                nombre: true,
                unidadMedida: true,
                stockActual: true,
                stockMinimo: true,
                activo: true,
              },
            },
          },
        },
      },
    });

    const porId = new Map(productos.map((p) => [p.id, p]));

    return filas
      .map((fila) => {
        const producto = porId.get(fila.id);
        // No deberia pasar (mismo snapshot, misma transaccion logica), pero si
        // alguien borra un producto entre las dos queries se saltea la fila en
        // vez de mandar un hueco.
        if (!producto) return null;

        const { receta, ...datos } = producto;

        return {
          ...datos,
          receta: receta.map((linea) => ({
            insumoId: linea.insumoId,
            cantidad: linea.cantidad,
            nombre: linea.insumo.nombre,
            unidadMedida: linea.insumo.unidadMedida,
            stockActual: linea.insumo.stockActual,
            stockMinimo: linea.insumo.stockMinimo,
            insumoActivo: linea.insumo.activo,
          })),
          // Misma cuenta que usa el menu publico, para que el panel y la carta
          // no den respuestas distintas sobre el mismo producto.
          ...disponibilidadDe(receta),
          ventas: {
            unidades: fila.unidades,
            facturado: fila.facturado,
            lineas: fila.lineas,
          },
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }
}
