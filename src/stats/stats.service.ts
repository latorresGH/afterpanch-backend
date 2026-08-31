import { BadRequestException, Injectable } from '@nestjs/common';
import { EstadoPedido, MetodoPago, Prisma, TipoPedido } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CajaService } from '../caja/caja.service';
import { PedidosService } from '../pedidos/pedidos.service';
import {
  ZONA_HORARIA_NEGOCIO,
  diasEnRango,
  finDelDia,
  inicioDelDia,
  inicioVentanaDias,
  parseFechaLocal,
  rangoAnterior,
} from '../common/helpers/fecha.helper';
import { EstadisticasQueryDto } from './dto/estadisticas-query.dto';

/** Ventana por defecto si no vienen ni `dias` ni `desde`/`hasta`. */
const DIAS_POR_DEFECTO = 14;

/** Cuántos productos entran en el ranking (y en el maridaje) por defecto. */
const TOP_PRODUCTOS_POR_DEFECTO = 5;

/**
 * Cuántas salsas/extras se devuelven por producto en el maridaje. El modal del
 * panel muestra cinco de cada lado; se recorta acá para no mandar la cola larga.
 */
const MARIDAJE_POR_PRODUCTO = 5;

/** Salsas y extras del ranking general. */
const TOP_SALSAS = 8;
const TOP_EXTRAS = 8;

/**
 * `extras` es `jsonb` y puede venir en null cuando la línea no lleva ninguno.
 * `jsonb_array_elements` sobre null no rompe (devuelve cero filas en un LATERAL),
 * pero sobre un jsonb que NO sea array tira error en ejecución. El CASE lo
 * normaliza a array vacío antes de expandir, así una fila mal formada resta un
 * dato en vez de tumbar la request entera.
 */
const EXTRAS_EXPANDIDOS = Prisma.sql`
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(pd."extras") = 'array'
         THEN pd."extras"
         ELSE '[]'::jsonb
    END
  ) AS ex
`;

interface Rango {
  inicio: Date;
  fin: Date;
}

/** Una salsa o un extra acompañando a un producto, con su conteo de líneas. */
interface Acompanamiento {
  id: string;
  nombre: string;
  lineas: number;
}

/** Maridaje ya indexado por producto: `productoId` → sus acompañamientos. */
type MaridajePorProducto = Map<string, Acompanamiento[]>;

@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cajaService: CajaService,
    private readonly pedidosService: PedidosService,
  ) {}

  /**
   * Todo el panel de Estadísticas en una sola request.
   *
   * Mismo criterio que el Home: un endpoint y no doce, porque el front vive en
   * Vercel y la API en Hetzner y cada fetch server-side es un round trip.
   *
   * NADA se calcula trayendo filas: cada bloque es un `aggregate`, un `groupBy`
   * o un `$queryRaw` que devuelve el resultado ya reducido. Lo único que viaja
   * son las filas del ranking, que están acotadas por `take`.
   */
  async getEstadisticas(query: EstadisticasQueryDto, ahora: Date = new Date()) {
    const rango = this.resolverRango(query, ahora);
    const previo = rangoAnterior(rango.inicio, rango.fin);
    const limiteTop = query.topProductos ?? TOP_PRODUCTOS_POR_DEFECTO;

    // Primera ola: todo lo que no depende de nada más.
    const [
      facturacion,
      facturacionPrevia,
      porDia,
      porEstado,
      porTipo,
      porMetodoPago,
      franjas,
      unidadesTotales,
      ranking,
      salsas,
      extras,
      caja,
      mejorDia,
      pendienteCobroGlobal,
    ] = await Promise.all([
      this.facturacionDe(rango),
      this.facturacionDe(previo),
      this.pedidosService.getFacturacionPorRango(rango.inicio, rango.fin),
      this.conteoPorEstado(rango),
      this.facturacionPorTipo(rango),
      this.facturacionPorMetodoPago(rango),
      this.franjasHorarias(rango),
      this.unidadesVendidas(rango),
      this.rankingProductos(rango, limiteTop),
      this.salsasMasPedidas(rango),
      this.extrasGratisVsCobrado(rango),
      this.cajaService.getResumenAgregado(rango.inicio, rango.fin),
      this.mejorDiaDeCaja(rango),
      this.pedidosService.getPendienteCobro(),
    ]);

    // Segunda ola: el maridaje solo tiene sentido para los productos del
    // ranking, así que necesita saber cuáles son.
    const idsTop = ranking.map((r) => r.productoId);
    const [maridajeSalsas, maridajeExtras] = await Promise.all([
      this.maridajeSalsas(rango, idsTop),
      this.maridajeExtras(rango, idsTop),
    ]);

    const topProductos = await this.componerTopProductos(
      ranking,
      unidadesTotales,
      maridajeSalsas,
      maridajeExtras,
    );

    const entregados =
      porEstado.find((e) => e.estado === EstadoPedido.ENTREGADO)?.pedidos ?? 0;
    const pedidosDelPeriodo = porEstado.reduce((acc, e) => acc + e.pedidos, 0);

    return {
      rango: {
        desde: this.claveDe(rango.inicio),
        hasta: this.claveDe(rango.fin),
        dias: diasEnRango(rango.inicio, rango.fin),
        anterior: {
          desde: this.claveDe(previo.inicio),
          hasta: this.claveDe(previo.fin),
        },
        zonaHoraria: ZONA_HORARIA_NEGOCIO,
      },

      facturacion: {
        ...facturacion,
        anterior: facturacionPrevia,
        delta: {
          monto: this.delta(facturacion.monto, facturacionPrevia.monto),
          pedidos: this.delta(facturacion.pedidos, facturacionPrevia.pedidos),
          ticketPromedio: this.delta(
            facturacion.ticketPromedio,
            facturacionPrevia.ticketPromedio,
          ),
        },
      },

      porDia: porDia.dias,

      entrega: {
        // Denominador: TODOS los pedidos del período, no solo los entregados.
        // Si se contara sobre entregados la tasa daría siempre 100%.
        pedidos: pedidosDelPeriodo,
        entregados,
        tasa: this.porcentaje(entregados, pedidosDelPeriodo),
        porEstado,
      },

      porTipo,
      porMetodoPago,
      franjasHorarias: franjas,
      topProductos,
      salsas,
      extras,

      caja: {
        entradas: caja.entradas,
        salidas: caja.salidas,
        neta: caja.balance,
        ticketsCerrados: caja.ticketsCerrados,
        ticketPromedio: caja.ticketPromedio,
        mejorDia,
        // Cuánto de lo que entró quedó después de las salidas.
        margen: this.porcentaje(caja.balance, caja.entradas),
      },

      /**
       * Facturación y caja NO tienen por qué dar igual, y el panel lo muestra
       * explicado en vez de esconderlo: facturación cuenta pedidos ENTREGADO
       * por `createdAt`, caja cuenta movimientos por `fechaConfirmacion`. Un
       * pedido entregado el lunes y cobrado el martes cae en días distintos.
       */
      conciliacion: {
        facturado: facturacion.monto,
        cobrado: caja.entradas,
        diferencia: facturacion.monto - caja.entradas,
        // Este NO está acotado al rango: es la deuda viva de todo el histórico,
        // el mismo número que muestra el Home.
        pendienteCobroGlobal,
      },
    };
  }

  // ---------------------------------------------------------------- rango

  /**
   * `desde`/`hasta` mandan si vienen; si no, la ventana de `dias` que termina
   * hoy. Con una sola de las dos fechas el rango se cierra sobre ese mismo día.
   */
  private resolverRango(query: EstadisticasQueryDto, ahora: Date): Rango {
    if (!query.desde && !query.hasta) {
      const dias = query.dias ?? DIAS_POR_DEFECTO;
      return { inicio: inicioVentanaDias(dias, ahora), fin: finDelDia(ahora) };
    }

    const textoDesde = query.desde ?? query.hasta!;
    const textoHasta = query.hasta ?? query.desde!;

    const desde = parseFechaLocal(textoDesde);
    const hasta = parseFechaLocal(textoHasta);

    // El DTO ya valida la forma; acá se cazan las fechas con forma válida pero
    // inexistentes, tipo 2026-02-31.
    if (!desde) {
      throw new BadRequestException(`La fecha "${textoDesde}" no existe`);
    }
    if (!hasta) {
      throw new BadRequestException(`La fecha "${textoHasta}" no existe`);
    }

    const inicio = inicioDelDia(desde);
    const fin = finDelDia(hasta);

    if (inicio.getTime() > fin.getTime()) {
      throw new BadRequestException(
        'El rango está invertido: "desde" es posterior a "hasta"',
      );
    }

    return { inicio, fin };
  }

  /** `where` compartido: pedidos que facturaron dentro del rango. */
  private entregadosEn(rango: Rango): Prisma.PedidoWhereInput {
    return {
      estado: EstadoPedido.ENTREGADO,
      createdAt: { gte: rango.inicio, lte: rango.fin },
    };
  }

  // ------------------------------------------------------------ bloques

  private async facturacionDe(rango: Rango) {
    const { _sum, _count } = await this.prisma.pedido.aggregate({
      where: this.entregadosEn(rango),
      _sum: { total: true, costoEnvio: true },
      _count: { _all: true },
    });

    const negocio = _sum.total ?? 0;
    const delivery = _sum.costoEnvio ?? 0;
    const pedidos = _count._all;

    return {
      monto: negocio + delivery,
      // `total` guarda SOLO los productos; el envío va aparte en `costoEnvio`.
      negocio,
      delivery,
      pedidos,
      ticketPromedio:
        pedidos > 0 ? Math.round((negocio + delivery) / pedidos) : 0,
    };
  }

  private async conteoPorEstado(rango: Rango) {
    const filas = await this.prisma.pedido.groupBy({
      by: ['estado'],
      where: { createdAt: { gte: rango.inicio, lte: rango.fin } },
      _count: { _all: true },
      _sum: { total: true, costoEnvio: true },
    });

    // Se devuelven los siete estados siempre, en el orden del enum, para que el
    // front no tenga que rellenar huecos ni ordenar.
    return Object.values(EstadoPedido).map((estado) => {
      const fila = filas.find((f) => f.estado === estado);
      return {
        estado,
        pedidos: fila?._count._all ?? 0,
        monto: (fila?._sum.total ?? 0) + (fila?._sum.costoEnvio ?? 0),
      };
    });
  }

  private async facturacionPorTipo(rango: Rango) {
    const filas = await this.prisma.pedido.groupBy({
      by: ['tipo'],
      where: this.entregadosEn(rango),
      _count: { _all: true },
      _sum: { total: true, costoEnvio: true },
    });

    const total = filas.reduce(
      (acc, f) => acc + (f._sum.total ?? 0) + (f._sum.costoEnvio ?? 0),
      0,
    );

    return Object.values(TipoPedido).map((tipo) => {
      const fila = filas.find((f) => f.tipo === tipo);
      const monto = (fila?._sum.total ?? 0) + (fila?._sum.costoEnvio ?? 0);
      return {
        tipo,
        pedidos: fila?._count._all ?? 0,
        monto,
        share: this.porcentaje(monto, total),
      };
    });
  }

  /**
   * Agrupado por método de pago, con los tres métodos siempre presentes.
   *
   * `metodoPago` es nullable en el schema y ningún flujo obliga a cargarlo, así
   * que el groupBy puede devolver una fila con la clave en null. No se expone
   * como un cuarto método —decisión de producto—, pero tampoco se descarta la
   * plata en silencio: va aparte en `sinRegistrar`, que existe para que el
   * total del bloque pueda cuadrarse contra facturación y para que el agujero
   * sea visible si alguna vez crece.
   */
  private async facturacionPorMetodoPago(rango: Rango) {
    const filas = await this.prisma.pedido.groupBy({
      by: ['metodoPago'],
      where: this.entregadosEn(rango),
      _count: { _all: true },
      _sum: { total: true, costoEnvio: true },
    });

    const montoDe = (fila?: (typeof filas)[number]) =>
      (fila?._sum.total ?? 0) + (fila?._sum.costoEnvio ?? 0);

    const total = filas.reduce((acc, f) => acc + montoDe(f), 0);

    const metodos = Object.values(MetodoPago).map((metodo) => {
      const fila = filas.find((f) => f.metodoPago === metodo);
      const monto = montoDe(fila);
      return {
        metodoPago: metodo,
        pedidos: fila?._count._all ?? 0,
        monto,
        share: this.porcentaje(monto, total),
      };
    });

    const sinDato = filas.find((f) => f.metodoPago === null);

    return {
      metodos,
      sinRegistrar: {
        pedidos: sinDato?._count._all ?? 0,
        monto: montoDe(sinDato),
      },
    };
  }

  /**
   * Histograma por hora del día.
   *
   * Doble `AT TIME ZONE` obligatorio: `createdAt` es `TIMESTAMP(3)` sin zona
   * guardando UTC (convención de Prisma). Hay que reinterpretarlo como UTC y
   * recién ahí pasarlo a hora del negocio. Sin eso, en UTC-3 un pedido de las
   * 00:30 local se contaría en la franja de las 03:00.
   *
   * La hora vuelve como `int` desde el SQL, no como timestamp: es el mismo
   * motivo por el que la serie diaria vuelve como texto. Si volviera un
   * `timestamp without time zone` el driver lo re-hidrataría interpretándolo
   * en UTC y la franja se correría otra vez.
   *
   * Se devuelven las 24 horas siempre. Recortar la ventana a la que el local
   * opera es decisión del front, que es el que sabe cuánto espacio tiene.
   */
  private async franjasHorarias(rango: Rango) {
    const filas = await this.prisma.$queryRaw<
      Array<{ hora: number; pedidos: number; monto: number }>
    >`
      SELECT
        EXTRACT(
          HOUR FROM ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${ZONA_HORARIA_NEGOCIO}
        )::int AS hora,
        COUNT(*)::int AS pedidos,
        COALESCE(SUM("total" + "costoEnvio"), 0)::float8 AS monto
      FROM "Pedido"
      WHERE "estado" = 'ENTREGADO'
        AND "createdAt" >= ${rango.inicio}
        AND "createdAt" <= ${rango.fin}
      GROUP BY hora
      ORDER BY hora ASC
    `;

    const porHora = new Map(filas.map((f) => [Number(f.hora), f]));

    const horas = Array.from({ length: 24 }, (_, hora) => {
      const fila = porHora.get(hora);
      return {
        hora,
        label: `${String(hora).padStart(2, '0')}:00`,
        pedidos: Number(fila?.pedidos ?? 0),
        monto: Number(fila?.monto ?? 0),
      };
    });

    // La hora pico es la de más pedidos. Si no hubo ninguno no hay pico: null,
    // y no la hora 0, que se leería como "el pico fue a medianoche".
    const pico = horas.reduce(
      (mejor, h) => (h.pedidos > (mejor?.pedidos ?? 0) ? h : mejor),
      null as (typeof horas)[number] | null,
    );

    return {
      horas,
      pico: pico && pico.pedidos > 0 ? pico : null,
      maxPedidos: Math.max(...horas.map((h) => h.pedidos), 0),
    };
  }

  private async unidadesVendidas(rango: Rango) {
    const { _sum } = await this.prisma.pedidoDetalle.aggregate({
      where: { pedido: this.entregadosEn(rango) },
      _sum: { cantidad: true },
    });
    return _sum.cantidad ?? 0;
  }

  /**
   * Ranking por unidades vendidas.
   *
   * `_count._all` es la cantidad de LÍNEAS de pedido con ese producto, que es
   * el denominador del maridaje: "de cada 10 milanesas que salieron, N
   * llevaban mayonesa" se mide por línea, no por unidad.
   *
   * Ojo con `subtotal`: incluye los extras cobrados de la línea, y en las
   * líneas de combo el precio está stampeado en la primera (las siguientes van
   * en 0). Es lo que realmente se facturó por esa línea, pero no es
   * `precio × cantidad` del producto suelto.
   */
  private async rankingProductos(rango: Rango, limite: number) {
    const filas = await this.prisma.pedidoDetalle.groupBy({
      by: ['productoId'],
      where: { pedido: this.entregadosEn(rango) },
      _sum: { cantidad: true, subtotal: true },
      _count: { _all: true },
      orderBy: { _sum: { cantidad: 'desc' } },
      take: limite,
    });

    return filas.map((f) => ({
      productoId: f.productoId,
      unidades: f._sum.cantidad ?? 0,
      facturado: f._sum.subtotal ?? 0,
      lineas: f._count._all,
    }));
  }

  private async componerTopProductos(
    ranking: Array<{
      productoId: string;
      unidades: number;
      facturado: number;
      lineas: number;
    }>,
    unidadesTotales: number,
    maridajeSalsas: MaridajePorProducto,
    maridajeExtras: MaridajePorProducto,
  ) {
    if (ranking.length === 0) return [];

    const productos = await this.prisma.producto.findMany({
      where: { id: { in: ranking.map((r) => r.productoId) } },
      select: { id: true, nombre: true, precio: true, imagenUrl: true },
    });
    const porId = new Map(productos.map((p) => [p.id, p]));

    return ranking.map((r, i) => {
      const producto = porId.get(r.productoId);
      const conPct = (items: Acompanamiento[] = []) =>
        items.slice(0, MARIDAJE_POR_PRODUCTO).map((item) => ({
          ...item,
          // Sobre las líneas DE ESE PRODUCTO, que es lo que hace legible el
          // "de cada 10 X, N con Y".
          pct: this.porcentaje(item.lineas, r.lineas),
        }));

      return {
        rank: i + 1,
        productoId: r.productoId,
        // Un producto borrado deja las líneas históricas en pie: el nombre se
        // degrada en vez de romper el bloque.
        nombre: producto?.nombre ?? 'Producto eliminado',
        precio: producto?.precio ?? 0,
        imagenUrl: producto?.imagenUrl ?? null,
        unidades: r.unidades,
        facturado: r.facturado,
        lineas: r.lineas,
        share: this.porcentaje(r.unidades, unidadesTotales),
        salsas: conPct(maridajeSalsas.get(r.productoId)),
        extras: conPct(maridajeExtras.get(r.productoId)),
      };
    });
  }

  /**
   * Con qué salsas se pide cada producto del ranking.
   *
   * Las salsas SÍ son una relación (`_AderezoToPedidoDetalle`, el M2M
   * implícito de Prisma), así que esto es un join común. Prisma no sabe
   * expresar un agregado sobre una tabla implícita, de ahí el raw.
   */
  private async maridajeSalsas(
    rango: Rango,
    productoIds: string[],
  ): Promise<MaridajePorProducto> {
    if (productoIds.length === 0) return new Map();

    const filas = await this.prisma.$queryRaw<
      Array<{ productoId: string; id: string; nombre: string; lineas: number }>
    >`
      SELECT
        pd."productoId" AS "productoId",
        a."id"          AS "id",
        a."nombre"      AS "nombre",
        COUNT(DISTINCT pd."id")::int AS lineas
      FROM "PedidoDetalle" pd
      JOIN "Pedido" ped ON ped."id" = pd."pedidoId"
      JOIN "_AderezoToPedidoDetalle" j ON j."B" = pd."id"
      JOIN "Aderezo" a ON a."id" = j."A"
      WHERE ped."estado" = 'ENTREGADO'
        AND ped."createdAt" >= ${rango.inicio}
        AND ped."createdAt" <= ${rango.fin}
        AND pd."productoId" IN (${Prisma.join(productoIds)})
      GROUP BY pd."productoId", a."id", a."nombre"
      ORDER BY lineas DESC
    `;

    return this.agruparPorProducto(filas);
  }

  /**
   * Con qué toppings/extras se pide cada producto del ranking.
   *
   * Acá sí hay JSONB: los extras viven en `PedidoDetalle.extras`. El array
   * está EXPANDIDO (un elemento por unidad, sin clave `cantidad`), así que
   * contar unidades es contar elementos — pero para el maridaje interesa en
   * cuántas LÍNEAS apareció, de ahí el `COUNT(DISTINCT pd."id")`.
   *
   * Se agrupa por `id` y no por `nombre` porque el nombre del JSON es un
   * snapshot del momento del pedido: si el extra se renombró, agrupar por
   * nombre partiría la serie en dos. El nombre actual sale del join contra
   * `Extra`; el del snapshot queda de respaldo por si el extra ya no existe.
   */
  private async maridajeExtras(
    rango: Rango,
    productoIds: string[],
  ): Promise<MaridajePorProducto> {
    if (productoIds.length === 0) return new Map();

    const filas = await this.prisma.$queryRaw<
      Array<{
        productoId: string;
        id: string;
        nombreSnapshot: string | null;
        nombreActual: string | null;
        lineas: number;
      }>
    >`
      SELECT
        pd."productoId"        AS "productoId",
        ex->>'id'              AS "id",
        MAX(ex->>'nombre')     AS "nombreSnapshot",
        MAX(e."nombre")        AS "nombreActual",
        COUNT(DISTINCT pd."id")::int AS lineas
      FROM "PedidoDetalle" pd
      JOIN "Pedido" ped ON ped."id" = pd."pedidoId"
      ${EXTRAS_EXPANDIDOS}
      LEFT JOIN "Extra" e ON e."id" = ex->>'id'
      WHERE ped."estado" = 'ENTREGADO'
        AND ped."createdAt" >= ${rango.inicio}
        AND ped."createdAt" <= ${rango.fin}
        AND pd."productoId" IN (${Prisma.join(productoIds)})
      GROUP BY pd."productoId", ex->>'id'
      ORDER BY lineas DESC
    `;

    return this.agruparPorProducto(
      filas.map((f) => ({
        productoId: f.productoId,
        id: f.id,
        nombre: f.nombreActual ?? f.nombreSnapshot ?? 'Extra eliminado',
        lineas: Number(f.lineas ?? 0),
      })),
    );
  }

  private agruparPorProducto(
    filas: Array<Acompanamiento & { productoId: string }>,
  ): MaridajePorProducto {
    const mapa: MaridajePorProducto = new Map();

    for (const fila of filas) {
      const lista = mapa.get(fila.productoId) ?? [];
      lista.push({
        id: fila.id,
        nombre: fila.nombre,
        lineas: Number(fila.lineas ?? 0),
      });
      mapa.set(fila.productoId, lista);
    }

    return mapa;
  }

  /**
   * Salsas más pedidas, medido en % de PEDIDOS que la llevaron.
   *
   * A propósito no se calcula el total de sachets: el DTO recibe
   * `aderezosIds: string[]`, un conjunto sin cantidad por salsa, así que el
   * absoluto exigiría inventar una fórmula. El porcentaje sale del dato tal
   * como está guardado.
   */
  private async salsasMasPedidas(rango: Rango) {
    const filas = await this.prisma.$queryRaw<
      Array<{ id: string; nombre: string; pedidos: number }>
    >`
      SELECT
        a."id"     AS "id",
        a."nombre" AS "nombre",
        COUNT(DISTINCT ped."id")::int AS pedidos
      FROM "PedidoDetalle" pd
      JOIN "Pedido" ped ON ped."id" = pd."pedidoId"
      JOIN "_AderezoToPedidoDetalle" j ON j."B" = pd."id"
      JOIN "Aderezo" a ON a."id" = j."A"
      WHERE ped."estado" = 'ENTREGADO'
        AND ped."createdAt" >= ${rango.inicio}
        AND ped."createdAt" <= ${rango.fin}
      GROUP BY a."id", a."nombre"
      ORDER BY pedidos DESC
      LIMIT ${TOP_SALSAS}
    `;

    // Denominador: pedidos entregados del período. Un pedido que llevó la
    // misma salsa en tres líneas cuenta una sola vez de los dos lados.
    const totalPedidos = await this.prisma.pedido.count({
      where: this.entregadosEn(rango),
    });

    return filas.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      pedidos: Number(f.pedidos ?? 0),
      pct: this.porcentaje(Number(f.pedidos ?? 0), totalPedidos),
    }));
  }

  /**
   * Extras: cuántos salieron gratis, cuántos cobrados y cuánto entró por ellos.
   *
   * El JSON ya trae resuelto el flag `cobrado` (la regla de
   * `Categoria.cantExtrasGratis` + `Extra.esPremium` aplicada al momento del
   * pedido), así que acá no se recalcula ninguna regla de negocio: se cuenta.
   *
   * `precio` es el de lista de la categoría en ese momento, y lo efectivamente
   * cobrado es ese precio solo cuando `cobrado` es true. Los `COALESCE` sobre
   * el cast cubren una fila sin la clave: sin ellos el `FILTER` la dejaría
   * afuera de las dos ramas y el extra desaparecería del conteo.
   */
  private async extrasGratisVsCobrado(rango: Rango) {
    const filas = await this.prisma.$queryRaw<
      Array<{
        id: string;
        nombreSnapshot: string | null;
        nombreActual: string | null;
        categoria: string | null;
        gratis: number;
        cobrados: number;
        recaudado: number;
      }>
    >`
      SELECT
        ex->>'id'          AS "id",
        MAX(ex->>'nombre') AS "nombreSnapshot",
        MAX(e."nombre")    AS "nombreActual",
        MAX(e."categoria") AS "categoria",
        COUNT(*) FILTER (
          WHERE NOT COALESCE((ex->>'cobrado')::boolean, false)
        )::int AS gratis,
        COUNT(*) FILTER (
          WHERE COALESCE((ex->>'cobrado')::boolean, false)
        )::int AS cobrados,
        COALESCE(
          SUM(COALESCE((ex->>'precio')::float8, 0)) FILTER (
            WHERE COALESCE((ex->>'cobrado')::boolean, false)
          ),
          0
        )::float8 AS recaudado
      FROM "PedidoDetalle" pd
      JOIN "Pedido" ped ON ped."id" = pd."pedidoId"
      ${EXTRAS_EXPANDIDOS}
      LEFT JOIN "Extra" e ON e."id" = ex->>'id'
      WHERE ped."estado" = 'ENTREGADO'
        AND ped."createdAt" >= ${rango.inicio}
        AND ped."createdAt" <= ${rango.fin}
      GROUP BY ex->>'id'
      ORDER BY (COUNT(*)) DESC
      LIMIT ${TOP_EXTRAS}
    `;

    const items = filas.map((f) => {
      const gratis = Number(f.gratis ?? 0);
      const cobrados = Number(f.cobrados ?? 0);
      return {
        id: f.id,
        nombre: f.nombreActual ?? f.nombreSnapshot ?? 'Extra eliminado',
        categoria: f.categoria ?? null,
        gratis,
        cobrados,
        unidades: gratis + cobrados,
        recaudado: Number(f.recaudado ?? 0),
        pctGratis: this.porcentaje(gratis, gratis + cobrados),
      };
    });

    // Los totales se piden aparte y no se suman sobre `items`: el LIMIT recorta
    // la cola, y sumando el top saldría un recaudado menor que el real.
    const [totales] = await this.prisma.$queryRaw<
      Array<{ gratis: number; cobrados: number; recaudado: number }>
    >`
      SELECT
        COUNT(*) FILTER (
          WHERE NOT COALESCE((ex->>'cobrado')::boolean, false)
        )::int AS gratis,
        COUNT(*) FILTER (
          WHERE COALESCE((ex->>'cobrado')::boolean, false)
        )::int AS cobrados,
        COALESCE(
          SUM(COALESCE((ex->>'precio')::float8, 0)) FILTER (
            WHERE COALESCE((ex->>'cobrado')::boolean, false)
          ),
          0
        )::float8 AS recaudado
      FROM "PedidoDetalle" pd
      JOIN "Pedido" ped ON ped."id" = pd."pedidoId"
      ${EXTRAS_EXPANDIDOS}
      WHERE ped."estado" = 'ENTREGADO'
        AND ped."createdAt" >= ${rango.inicio}
        AND ped."createdAt" <= ${rango.fin}
    `;

    const gratis = Number(totales?.gratis ?? 0);
    const cobrados = Number(totales?.cobrados ?? 0);

    return {
      items,
      totales: {
        gratis,
        cobrados,
        unidades: gratis + cobrados,
        recaudado: Number(totales?.recaudado ?? 0),
        pctGratis: this.porcentaje(gratis, gratis + cobrados),
      },
    };
  }

  /**
   * El día de más entradas del período.
   *
   * Mismo tratamiento de zona que la serie diaria: doble `AT TIME ZONE` y el
   * día de vuelta como texto vía `to_char`, nunca como timestamp.
   *
   * Filtra por `fechaConfirmacion` porque es el criterio de caja. Es nullable:
   * un movimiento sin confirmar no entra en ningún reporte, que es lo mismo
   * que ya hace `getResumenAgregado`.
   */
  private async mejorDiaDeCaja(rango: Rango) {
    const filas = await this.prisma.$queryRaw<
      Array<{ dia: string; entradas: number }>
    >`
      SELECT
        to_char(
          date_trunc(
            'day',
            ("fechaConfirmacion" AT TIME ZONE 'UTC') AT TIME ZONE ${ZONA_HORARIA_NEGOCIO}
          ),
          'YYYY-MM-DD'
        ) AS dia,
        COALESCE(
          SUM("montoTotal") FILTER (WHERE "tipo" = 'ENTRADA'),
          0
        )::float8 AS entradas
      FROM "CajaMovimiento"
      WHERE "fechaConfirmacion" >= ${rango.inicio}
        AND "fechaConfirmacion" <= ${rango.fin}
      GROUP BY dia
      ORDER BY entradas DESC
      LIMIT 1
    `;

    if (filas.length === 0 || Number(filas[0].entradas) === 0) return null;

    return { fecha: filas[0].dia, entradas: Number(filas[0].entradas) };
  }

  // ------------------------------------------------------------- helpers

  /** `2026-08-23` en hora local, sin pasar por UTC. */
  private claveDe(fecha: Date): string {
    const año = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    return `${año}-${mes}-${dia}`;
  }

  /** Porcentaje con un decimal. Sin base, 0 — nunca NaN ni Infinity. */
  private porcentaje(parte: number, total: number): number {
    if (!total) return 0;
    return Math.round((parte / total) * 1000) / 10;
  }

  /**
   * Variación porcentual contra el período anterior.
   *
   * Con base 0 no hay variación que calcular (todo sería infinito), así que
   * devuelve 0 y deja que el front decida cómo mostrar "sin comparación".
   */
  private delta(actual: number, anterior: number): number {
    if (!anterior) return 0;
    return Math.round(((actual - anterior) / anterior) * 1000) / 10;
  }
}
