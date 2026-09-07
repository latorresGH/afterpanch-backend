import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Prisma,
  TipoMovimientoCaja,
  EstadoPedido,
  TipoPedido,
} from '@prisma/client';
import {
  GrupoMovimientos,
  agruparMovimientos,
  derivarTotales,
} from './caja.totales';
import type { RangoResuelto } from './caja.rango';

/**
 * Quien esta registrando el movimiento. Sale SIEMPRE del JWT, nunca del body:
 * el controller lo arma con `req.user`, y por eso ningun DTO de caja acepta
 * mas un `confirmadoPor`. Antes el front mandaba los literales 'Admin' y
 * 'POS', y cualquiera con sesion podia escribir el nombre que quisiera.
 */
export interface ActorCaja {
  /** `req.user.sub` → va a `registradoPorId`, la autoria de verdad. */
  id: string;
  /** `req.user.nombre` → va a `confirmadoPor`, snapshot de texto. */
  nombre: string;
}

/**
 * Resultado de confirmar el cobro de un pedido.
 *
 * `yaExistia` distingue "lo cobre yo recien" de "ya estaba cobrado". La
 * operacion es idempotente: pedir dos veces el cobro del mismo pedido no
 * explota ni duplica, devuelve el movimiento que ya estaba. Pero quien llama
 * necesita saber cual de las dos cosas paso, porque sumar el monto de un cobro
 * que ya estaba contado inflaria el total del lote.
 */
export interface ResultadoPago {
  movimiento: Prisma.CajaMovimientoGetPayload<object>;
  yaExistia: boolean;
}

/** El error que tira Postgres cuando choca contra una UNIQUE. */
function esConflictoDeUnicidad(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class CajaService {
  constructor(private prisma: PrismaService) {}

  /**
   * Registra el cobro de un pedido. IDEMPOTENTE: si el pedido ya estaba
   * cobrado devuelve ese movimiento con `yaExistia: true` en vez de tirar.
   *
   * Hay DOS defensas contra el doble cobro, y las dos hacen falta:
   *
   *   1. El `findFirst` de aca abajo, que es el camino rapido y da un
   *      resultado limpio en el caso normal (alguien aprieta "confirmar" sobre
   *      un pedido que ya se cobro hace una hora).
   *
   *   2. La UNIQUE `(pedidoId, tipo)` de la base, que es la garantia de
   *      verdad. El findFirst solo NO alcanza: Postgres corre en READ
   *      COMMITTED, asi que dos confirmaciones concurrentes del mismo pedido
   *      leen las dos "no hay movimiento" y las dos insertan. Antes de la
   *      restriccion, eso contaba la venta dos veces en el resumen.
   *
   * El `catch` de P2002 es exactamente esa carrera: la perdio esta request,
   * la otra ya inserto. No es un error — el pedido quedo cobrado una sola vez,
   * que es lo que se pedia.
   */
  async registrarPagoPedido(
    pedidoId: string,
    actor: ActorCaja,
    gananciaRepartidor?: number,
  ): Promise<ResultadoPago> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const pedido = await tx.pedido.findUnique({
          where: { id: pedidoId },
          select: {
            id: true,
            estado: true,
            total: true,
            costoEnvio: true,
            tipo: true,
          },
        });

        if (!pedido) throw new NotFoundException('Pedido no encontrado');

        if (pedido.estado === EstadoPedido.CANCELADO) {
          throw new BadRequestException(
            'No se puede registrar pago de un pedido cancelado',
          );
        }

        // Un delivery se cobra cuando llego, no antes. Sin esto un pedido en
        // preparacion se podia dar por cobrado, y despues ya no se podia
        // cancelar sin dejar la ENTRADA huerfana en la caja.
        //
        // Solo aplica a DELIVERY: un LOCAL o un RETIRO se cobran en el
        // mostrador y no tienen por que haber pasado por ENTREGADO.
        if (
          pedido.tipo === TipoPedido.DELIVERY &&
          pedido.estado !== EstadoPedido.ENTREGADO
        ) {
          throw new BadRequestException(
            `El pedido todavía no fue entregado (está ${pedido.estado}): ` +
              'no se puede registrar el cobro hasta que llegue.',
          );
        }

        // Acotado a ENTRADA (y no a cualquier movimiento del pedido) para que
        // coincida con la UNIQUE: una devolucion futura sobre el mismo pedido
        // seria una SALIDA y no tiene por que bloquear nada.
        const movimientoExistente = await tx.cajaMovimiento.findFirst({
          where: { pedidoId, tipo: TipoMovimientoCaja.ENTRADA },
        });

        if (movimientoExistente) {
          return { movimiento: movimientoExistente, yaExistia: true };
        }

        const productosTotal = Number(pedido.total);
        const costoEnvio = Number(pedido.costoEnvio) || 0;
        const montoTotal = productosTotal + costoEnvio;
        const gananciaRepart = gananciaRepartidor ?? costoEnvio;

        if (gananciaRepart > montoTotal) {
          throw new BadRequestException(
            `La ganancia del repartidor (${gananciaRepart}) no puede ser mayor al total del pedido (${montoTotal})`,
          );
        }

        const gananciaNegocio = productosTotal;

        const movimiento = await tx.cajaMovimiento.create({
          data: {
            pedidoId,
            tipo: TipoMovimientoCaja.ENTRADA,
            montoTotal,
            gananciaNegocio,
            gananciaRepartidor: gananciaRepart,
            descripcion: `Pago registrado para pedido ${pedidoId}`,
            confirmadoPor: actor.nombre,
            registradoPorId: actor.id,
            fechaConfirmacion: new Date(),
          },
        });

        return { movimiento, yaExistia: false };
      });
    } catch (error) {
      if (!esConflictoDeUnicidad(error)) throw error;

      // Se perdio la carrera: otra request inserto el movimiento entre el
      // findFirst y el create. La lectura va FUERA de la transaccion porque
      // esa ya quedo abortada por el conflicto.
      const existente = await this.prisma.cajaMovimiento.findFirst({
        where: { pedidoId, tipo: TipoMovimientoCaja.ENTRADA },
      });

      if (existente) return { movimiento: existente, yaExistia: true };

      // La UNIQUE salto por otra cosa: no la tapamos.
      throw error;
    }
  }

  /**
   * Confirma el cobro de varios pedidos de una.
   *
   * Cada pedido va en SU PROPIA transaccion (reusando `registrarPagoPedido`),
   * no en una sola global: si uno esta cancelado o no existe, no tiene por que
   * tumbar a los otros cuatro. Por eso reporta exito parcial en vez de tirar.
   *
   * Confirma todos sin distincion, con el `costoEnvio` que cada pedido tenga
   * en ese momento —incluso 0—, que es el valor que `registrarPagoPedido`
   * toma por defecto como ganancia del repartidor.
   *
   * Secuencial a proposito: en paralelo serian N transacciones simultaneas
   * compitiendo por el pool de conexiones, para un lote que como mucho tiene
   * unas pocas decenas de pedidos.
   *
   * Los que YA estaban cobrados salen aparte, en `yaConfirmados`, y no suman a
   * `totalConfirmado`. No son un error (el pedido esta cobrado, que es lo que
   * se pedia) pero tampoco son plata que entro recien: contarlos ahi inflaria
   * el total que se le muestra al usuario con dinero ya contabilizado.
   */
  async confirmarLote(pedidoIds: string[], actor: ActorCaja) {
    const confirmados: Array<{
      pedidoId: string;
      movimientoId: string;
      monto: number;
    }> = [];
    const yaConfirmados: Array<{ pedidoId: string; movimientoId: string }> = [];
    const fallidos: Array<{ pedidoId: string; motivo: string }> = [];

    // Sin duplicados: si llega el mismo id dos veces, el segundo caeria en
    // `yaConfirmados` por su propio hermano y ensuciaria el reporte.
    for (const pedidoId of [...new Set(pedidoIds)]) {
      try {
        const { movimiento, yaExistia } = await this.registrarPagoPedido(
          pedidoId,
          actor,
        );

        if (yaExistia) {
          yaConfirmados.push({ pedidoId, movimientoId: movimiento.id });
        } else {
          confirmados.push({
            pedidoId,
            movimientoId: movimiento.id,
            monto: movimiento.montoTotal,
          });
        }
      } catch (error: any) {
        fallidos.push({
          pedidoId,
          motivo: error?.message ?? 'Error desconocido',
        });
      }
    }

    return {
      confirmados,
      yaConfirmados,
      fallidos,
      totalConfirmado: confirmados.reduce((acc, c) => acc + c.monto, 0),
    };
  }

  /**
   * Movimiento manual de caja: un gasto, una entrada suelta, una correccion.
   *
   * `gananciaNegocio` y `gananciaRepartidor` van en CERO, siempre. Esos dos
   * campos son el reparto de lo que pago un cliente por un pedido; en un gasto
   * no significan nada. Antes una SALIDA guardaba `gananciaNegocio: -monto`, y
   * como el resumen sumaba `montoTotal` a "salidas" Y `gananciaNegocio` a
   * "negocio", el mismo gasto se restaba dos veces en la misma pantalla.
   *
   * El signo lo lleva el `tipo`, no el monto: ENTRADA y SALIDA se guardan las
   * dos con `montoTotal` positivo. La unica excepcion es AJUSTE, que es una
   * correccion y puede ir para cualquier lado.
   */
  async registrarMovimientoManual(data: {
    tipo: TipoMovimientoCaja;
    monto: number;
    descripcion?: string;
    actor: ActorCaja;
  }) {
    const { tipo, monto, descripcion, actor } = data;

    if (!Number.isFinite(monto)) {
      throw new BadRequestException('El monto tiene que ser un numero');
    }

    if (tipo === TipoMovimientoCaja.AJUSTE) {
      if (monto === 0) {
        throw new BadRequestException(
          'Un ajuste de 0 no corrige nada: mandá un monto positivo o negativo',
        );
      }
    } else if (monto <= 0) {
      throw new BadRequestException(
        `El monto de un movimiento ${tipo} tiene que ser mayor a 0. ` +
          'La direccion la marca el tipo, no el signo del monto.',
      );
    }

    return this.prisma.cajaMovimiento.create({
      data: {
        tipo,
        montoTotal: monto,
        gananciaNegocio: 0,
        gananciaRepartidor: 0,
        descripcion: descripcion || `Movimiento manual de ${tipo}`,
        confirmadoPor: actor.nombre,
        registradoPorId: actor.id,
        fechaConfirmacion: new Date(),
      },
    });
  }

  /**
   * Agrupa los movimientos de un rango en la base, sin traer ni una fila de
   * detalle: como mucho vuelven 12 filas (3 tipos x 2 signos x 2 origenes).
   *
   * Se agrupa tambien por signo y por origen —y no solo por `tipo`— porque son
   * los tres ejes que `derivarTotales` necesita: sin el signo, un ajuste de
   * +1000 y otro de -1000 se cancelarian antes de llegar a los totales y las
   * dos puntas desaparecerian del resumen.
   *
   * Usa el indice `[fechaConfirmacion]` para el rango.
   */
  private async agruparEnBase(
    inicio?: Date,
    fin?: Date,
  ): Promise<GrupoMovimientos[]> {
    const filtros: Prisma.Sql[] = [];
    if (inicio) filtros.push(Prisma.sql`"fechaConfirmacion" >= ${inicio}`);
    if (fin) filtros.push(Prisma.sql`"fechaConfirmacion" <= ${fin}`);

    const where = filtros.length
      ? Prisma.sql`WHERE ${Prisma.join(filtros, ' AND ')}`
      : Prisma.empty;

    return this.prisma.$queryRaw<GrupoMovimientos[]>`
      SELECT "tipo"::text                                  AS "tipo",
             ("montoTotal" >= 0)                           AS "positivo",
             ("pedidoId" IS NOT NULL)                      AS "dePedido",
             COUNT(*)::int                                 AS "filas",
             COALESCE(SUM("montoTotal"), 0)::float8        AS "monto",
             COALESCE(SUM("gananciaNegocio"), 0)::float8   AS "negocio",
             COALESCE(SUM("gananciaRepartidor"), 0)::float8 AS "repartidor"
      FROM "CajaMovimiento"
      ${where}
      GROUP BY 1, 2, 3
    `;
  }

  /**
   * Resumen de caja de un rango, resuelto con un agregado en Postgres: no
   * viaja ninguna fila de detalle, la base devuelve los totales ya sumados.
   *
   * Lo consumen el Home y el panel de stats. Da EXACTAMENTE los mismos numeros
   * que `obtenerResumenCaja` para el mismo rango, porque los dos terminan en
   * `derivarTotales`; lo unico que cambia es de donde salen los grupos.
   */
  async getResumenAgregado(inicio: Date, fin: Date) {
    return derivarTotales(await this.agruparEnBase(inicio, fin));
  }

  /**
   * Movimientos de un rango, para la lista del Home. Acotado por fecha (un
   * dia), asi que no necesita paginar: no crece con el historico.
   */
  async getMovimientosDelRango(inicio: Date, fin: Date) {
    return this.prisma.cajaMovimiento.findMany({
      where: { fechaConfirmacion: { gte: inicio, lte: fin } },
      select: {
        id: true,
        tipo: true,
        montoTotal: true,
        descripcion: true,
        confirmadoPor: true,
        registradoPorId: true,
        fechaConfirmacion: true,
        pedido: {
          select: { id: true, nombreCliente: true, apellidoCliente: true },
        },
      },
      orderBy: { fechaConfirmacion: 'desc' },
    });
  }

  /**
   * El `where` de un rango YA RESUELTO.
   *
   * Antes esta funcion volvia a normalizar las fechas a dia calendario
   * (`setHours(0,0,0,0)` / `23:59:59.999`) sobre lo que le llegara. Eso hacia
   * imposible pedir un rango con hora —justo lo que necesita el dia comercial,
   * que arranca 02:30— y ademas corria un dia los filtros que mandaban una
   * fecha sola, porque `new Date('2026-09-07')` se interpreta como UTC.
   *
   * Ahora el rango llega resuelto desde el controller (`resolverRangoCaja`) y
   * aca solo se traduce a Prisma, tal cual, sin tocar las puntas.
   */
  private whereDelRango(rango?: RangoResuelto) {
    if (!rango?.inicio && !rango?.fin) return {};

    const fechaConfirmacion: { gte?: Date; lte?: Date } = {};
    if (rango.inicio) fechaConfirmacion.gte = rango.inicio;
    if (rango.fin) fechaConfirmacion.lte = rango.fin;

    return { fechaConfirmacion };
  }

  /**
   * Resumen + movimientos de un rango, para las pantallas de caja.
   *
   * Los totales salen del MISMO `derivarTotales` que usa el Home: como este
   * camino ya necesita la lista completa para mostrarla, se agrupa lo que ya
   * esta en memoria en vez de pedirle a la base una segunda cuenta. Un solo
   * lugar donde vive la aritmetica, dos formas de alimentarlo.
   */
  async obtenerResumenCaja(rango?: RangoResuelto) {
    const where = this.whereDelRango(rango);
    const movimientos = await this.prisma.cajaMovimiento.findMany({
      where,
      include: {
        pedido: {
          select: {
            id: true,
            nombreCliente: true,
            apellidoCliente: true,
            total: true,
            estado: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totales = derivarTotales(agruparMovimientos(movimientos));

    return {
      resumen: {
        // Nombres historicos, que es lo que leen las dos pantallas de caja.
        totalEntradas: totales.entradas,
        totalSalidas: totales.salidas,
        gananciaNegocioTotal: totales.gananciaNegocio,
        gananciaRepartidorTotal: totales.gananciaRepartidor,
        balance: totales.balance,

        // Agregados por la unificacion: mismos numeros que ve el Home.
        cobrado: totales.cobrado,
        ticketsCerrados: totales.ticketsCerrados,
        ticketPromedio: totales.ticketPromedio,
      },

      // Que periodo se aplico de verdad, para que la pantalla muestre el
      // rango real y no lo vuelva a calcular por su cuenta.
      periodo: rango?.periodo ?? 'TODO',
      desde: rango?.inicio ?? null,
      hasta: rango?.fin ?? null,

      movimientos,
    };
  }

  async getHistorialPaginado(
    pagina: number,
    limit: number,
    rango?: RangoResuelto,
  ) {
    const where = this.whereDelRango(rango);
    const skip = (pagina - 1) * limit;

    const [movimientos, total] = await Promise.all([
      this.prisma.cajaMovimiento.findMany({
        where,
        include: {
          pedido: {
            select: {
              id: true,
              nombreCliente: true,
              apellidoCliente: true,
              total: true,
              estado: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.cajaMovimiento.count({ where }),
    ]);

    return {
      movimientos,
      total,
      pagina,
      totalPaginas: Math.ceil(total / limit),
      limit,
    };
  }

  async obtenerMovimientosPorPedido(pedidoId: string) {
    return this.prisma.cajaMovimiento.findMany({
      where: { pedidoId },
      include: {
        pedido: {
          select: {
            id: true,
            nombreCliente: true,
            apellidoCliente: true,
            total: true,
          },
        },
      },
    });
  }

  async eliminarMovimiento(id: string, motivo: string) {
    const movimiento = await this.prisma.cajaMovimiento.findUnique({
      where: { id },
    });

    if (!movimiento) {
      throw new NotFoundException('Movimiento no encontrado');
    }

    return this.prisma.cajaMovimiento.update({
      where: { id },
      data: {
        descripcion: `${movimiento.descripcion} [ANULADO: ${motivo}]`,
      },
    });
  }
}
