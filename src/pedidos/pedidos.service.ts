import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { randomUUID, randomBytes } from 'crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreatePedidoDto, TipoPedidoDto } from './dto/create-pedido.dto';
import {
  EstadoPedido,
  Prisma,
  Role,
  MetodoPago,
  TipoOferta,
  TipoMovimientoCaja,
} from '@prisma/client';
import {
  ZONA_HORARIA_NEGOCIO,
  claveFecha,
  codigoPedido,
  inicioVentanaDias,
} from '../common/helpers/fecha.helper';
import { OfertasCalculatorService } from '../ofertas/ofertas-calculator.service';
import { NegocioConfigService } from '../config/config.service';
import { PedidosGateway } from './pedidos.gateway';
import { tieneAccesoTracking } from './tracking.util';

const ESTADOS_ABIERTOS: EstadoPedido[] = [
  EstadoPedido.PENDIENTE,
  EstadoPedido.EN_PREPARACION,
  EstadoPedido.LISTO_PARA_RETIRAR,
  EstadoPedido.EN_CAMINO,
];

/** Un pedido en estos estados ya no se trabaja: sale del monitor. */
const ESTADOS_CERRADOS: EstadoPedido[] = [
  EstadoPedido.ENTREGADO,
  EstadoPedido.CANCELADO,
];

/**
 * Estados que muestra el monitor del POS.
 *
 * Se define por EXCLUSIÓN de los cerrados, no reusando ESTADOS_ABIERTOS: esa
 * constante no incluye PROBLEMA_DIRECCION, y el monitor hoy sí muestra esos
 * pedidos (filtra en el cliente por `estado !== CANCELADO && !== ENTREGADO`).
 * Reusarla habría escondido en silencio los pedidos con problema de dirección,
 * justo en la pantalla donde hay que resolverlos.
 *
 * Derivarlo del enum además evita que se desincronice si mañana se agrega un
 * estado nuevo: aparece en el monitor por defecto, igual que hoy.
 */
export const ESTADOS_MONITOR: EstadoPedido[] = Object.values(
  EstadoPedido,
).filter((estado) => !ESTADOS_CERRADOS.includes(estado));

/** A partir de estos minutos sin cerrarse, un pedido se marca como demorado. */
export const MINUTOS_PEDIDO_DEMORADO = 30;

/** Minutos enteros transcurridos desde `desde` hasta ahora (nunca negativo). */
export function minutosDesde(desde: Date, ahora: Date = new Date()): number {
  const ms = ahora.getTime() - new Date(desde).getTime();
  return Math.max(0, Math.floor(ms / 60_000));
}

const TRANSICIONES_VALIDAS: Record<EstadoPedido, EstadoPedido[]> = {
  [EstadoPedido.PENDIENTE]: [EstadoPedido.EN_PREPARACION, EstadoPedido.CANCELADO],
  [EstadoPedido.EN_PREPARACION]: [EstadoPedido.LISTO_PARA_RETIRAR, EstadoPedido.CANCELADO],
  [EstadoPedido.LISTO_PARA_RETIRAR]: [EstadoPedido.ENTREGADO, EstadoPedido.CANCELADO],
  [EstadoPedido.EN_CAMINO]: [EstadoPedido.ENTREGADO, EstadoPedido.CANCELADO],
  [EstadoPedido.ENTREGADO]: [],
  [EstadoPedido.CANCELADO]: [],
  [EstadoPedido.PROBLEMA_DIRECCION]: [EstadoPedido.EN_PREPARACION, EstadoPedido.CANCELADO],
};

@Injectable()
export class PedidosService {
  private readonly logger = new Logger(PedidosService.name);

  constructor(
    private prisma: PrismaService,
    private ofertasCalculator: OfertasCalculatorService,
    private configService: NegocioConfigService,
    private pedidosGateway: PedidosGateway,
  ) {}

  async crearPedido(
    dto: CreatePedidoDto,
    actor?: { sub?: string; role?: Role; email?: string } | null,
  ) {
    const [horaAperturaStr, horaCierreStr] = await Promise.all([
      this.configService.obtener('hora_apertura'),
      this.configService.obtener('hora_cierre'),
    ]);

    const demoraResult = await this.getDemoraActual();
    const demoraSnapshot = demoraResult.minutos;

    if (horaAperturaStr && horaCierreStr) {
      const ahora = new Date();
      const opciones: Intl.DateTimeFormatOptions = {
        timeZone: 'America/Argentina/Mendoza',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      };
      const horaActualStr = ahora.toLocaleTimeString('es-AR', opciones);
      const [horaActualHoras, horaActualMinutos] = horaActualStr.split(':').map(Number);
      const horaActual = horaActualHoras * 60 + horaActualMinutos;

      const [horaAp, minAp] = horaAperturaStr.split(':').map(Number);
      const [horaCi, minCi] = horaCierreStr.split(':').map(Number);
      const horaApertura = horaAp * 60 + (minAp || 0);
      const horaCierre = horaCi * 60 + (minCi || 0);

      const cruzaMedianoche = horaCierre < horaApertura;
      const estaAbierto = cruzaMedianoche
        ? (horaActual >= horaApertura || horaActual < horaCierre)
        : (horaActual >= horaApertura && horaActual < horaCierre);

      if (!estaAbierto) {
        throw new BadRequestException(
          `Estamos cerrados. Horario de atención: ${horaAperturaStr} a ${horaCierreStr}`,
        );
      }
    }

    const {
      tipo,
      direccion,
      detalles,
      pedidoId,
      nombreCliente,
      apellidoCliente,
      metodoPago,
      numeroCliente,
      costoEnvio,
      origen,
      direccionLat,
      direccionLng,
      direccionFormateada,
      piso,
      departamento,
      referencias,
      notasRepartidor,
  shippingZoneName,
  shippingReason,
  direccionPrecision,
} = dto;

    if (!detalles || detalles.length === 0) {
      throw new BadRequestException('El pedido no tiene productos');
    }

    // SEGURIDAD (costoEnvio): el cliente anónimo NO puede influir en el costo de envío.
    // - Empleado autenticado (ADMIN/TRABAJADOR vía JWT): se respeta el costoEnvio manual del body.
    // - Cualquier otro caso (menú público anónimo): se ignora el body y se usa el valor
    //   server-side `delivery_precio_base` de config. Es solo un placeholder; el empleado
    //   ajusta el costo real luego con setCostoEnvio/asignarRepartidor.
    const esEmpleado =
      actor?.role === Role.ADMIN || actor?.role === Role.TRABAJADOR;
    let costoEnvioPublico = 0;
    if (!esEmpleado && tipo === TipoPedidoDto.DELIVERY) {
      const base = Number(await this.configService.obtener('delivery_precio_base'));
      costoEnvioPublico = Number.isFinite(base) && base >= 0 ? base : 0;
    }

    if (tipo === TipoPedidoDto.DELIVERY && (!direccion || !direccion.trim())) {
      throw new BadRequestException(
        'La dirección es obligatoria para DELIVERY',
      );
    }

    const nombreClienteLimpio = nombreCliente?.trim() || null;
    const apellidoClienteLimpio = apellidoCliente?.trim() || null;
    const numeroClienteLimpio = numeroCliente?.trim() || null;

    if (
      !pedidoId &&
      (!nombreClienteLimpio || nombreClienteLimpio.length === 0)
    ) {
      throw new BadRequestException('nombreCliente es obligatorio');
    }

    return this.prisma.$transaction(async (tx) => {
      const productoIds = detalles.map((d) => d.productoId);
      const productos = await tx.producto.findMany({
        where: { id: { in: productoIds } },
        select: {
          id: true,
          precio: true,
          activo: true,
          nombre: true,
          categoriaId: true,
          categoria: {
            select: {
              cantExtrasGratis: true,
            },
          },
          receta: {
            include: { insumo: { select: { id: true, stockActual: true } } },
          },
        },
      });

      const prodMap = new Map(
        productos.map((p) => [
          p.id,
          {
            precio: Number(p.precio),
            activo: Boolean(p.activo),
            nombre: p.nombre,
            categoriaId: p.categoriaId,
            cantExtrasGratis: p.categoria?.cantExtrasGratis ?? 2,
            receta: p.receta,
          },
        ]),
      );

      for (const pid of productoIds) {
        if (!prodMap.has(pid))
          throw new BadRequestException(`Producto no encontrado: ${pid}`);
        if (prodMap.get(pid)!.activo === false)
          throw new BadRequestException(`Producto inactivo: ${pid}`);
      }

      // --- COMBOS ---
      // Cada línea con `comboId` pertenece a una oferta-combo. El precio SIEMPRE lo fija
      // el servidor (oferta.precio), nunca el cliente.
      // Las líneas se agrupan en "instancias": el cliente puede mandar `comboInstanciaId`
      // (permite el mismo combo N veces); si no viene, se agrupa por comboId. El precio
      // NUNCA depende del valor del cliente.
      const comboIdsUnicos = Array.from(
        new Set(
          (detalles as any[])
            .map((d) => d.comboId)
            .filter((id): id is string => !!id),
        ),
      );

      // Definición de cada combo: nombre + precio fijo + composición esperada (productoId -> cantidad).
      const comboMap = new Map<
        string,
        { nombre: string; precio: number; esperado: Map<string, number> }
      >();
      // Clave de instancia -> id de instancia persistido (valor del cliente o uuid del server).
      const instanciaStoredId = new Map<string, string>();
      const hayCombos = comboIdsUnicos.length > 0;

      // Clave de agrupación de una línea de combo: usa el comboInstanciaId del cliente si
      // vino; si no, agrupa todas las líneas del mismo comboId bajo una sola instancia.
      const claveInstancia = (d: any): string =>
        d.comboInstanciaId ? `c:${d.comboInstanciaId}` : `g:${d.comboId}`;

      if (hayCombos) {
        const combosDb = await tx.oferta.findMany({
          where: { id: { in: comboIdsUnicos } },
          select: {
            id: true,
            nombre: true,
            tipo: true,
            activa: true,
            precio: true,
            productos: { select: { productoId: true, cantidadMin: true } },
          },
        });
        const combosDbMap = new Map(combosDb.map((c) => [c.id, c]));

        for (const comboId of comboIdsUnicos) {
          const combo = combosDbMap.get(comboId);
          if (!combo) {
            throw new BadRequestException(`Combo no encontrado: ${comboId}`);
          }
          if (combo.tipo !== TipoOferta.COMBO) {
            throw new BadRequestException(`La oferta ${comboId} no es un combo`);
          }
          if (!combo.activa) {
            throw new BadRequestException(`El combo ${comboId} no está activo`);
          }
          if (combo.precio === null || combo.precio === undefined) {
            throw new BadRequestException(
              `El combo ${comboId} no tiene precio configurado`,
            );
          }

          // Multiset esperado: un combo puede repetir el mismo producto en varias
          // filas de OfertaProducto (ej: 2x Pancho Simple). Se ACUMULA la cantidad
          // de cada fila en vez de sobreescribir, así el conteo por producto es correcto.
          const esperado = new Map<string, number>();
          for (const p of combo.productos) {
            esperado.set(
              p.productoId,
              (esperado.get(p.productoId) ?? 0) + (p.cantidadMin ?? 1),
            );
          }
          comboMap.set(comboId, {
            nombre: combo.nombre,
            precio: Number(combo.precio),
            esperado,
          });
        }

        // SEGURIDAD 1 (pertenencia): cada línea marcada con un comboId debe ser un
        // producto de la definición de ese combo. Evita colar un producto caro a $0.
        for (const d of detalles as any[]) {
          if (!d.comboId) continue;
          if (!comboMap.get(d.comboId)!.esperado.has(d.productoId)) {
            throw new BadRequestException(
              `El producto ${d.productoId} no pertenece al combo ${d.comboId}`,
            );
          }
        }

        // Agrupa las líneas de combo por instancia.
        const gruposInstancia = new Map<
          string,
          { comboId: string; comboInstanciaId?: string; cantidades: Map<string, number> }
        >();
        for (const d of detalles as any[]) {
          if (!d.comboId) continue;
          const key = claveInstancia(d);
          let grupo = gruposInstancia.get(key);
          if (!grupo) {
            grupo = {
              comboId: d.comboId,
              comboInstanciaId: d.comboInstanciaId,
              cantidades: new Map(),
            };
            gruposInstancia.set(key, grupo);
          }
          // Todas las líneas de una instancia deben compartir el mismo comboId.
          if (grupo.comboId !== d.comboId) {
            throw new BadRequestException(
              `La instancia de combo ${key} mezcla combos distintos`,
            );
          }
          grupo.cantidades.set(
            d.productoId,
            (grupo.cantidades.get(d.productoId) ?? 0) + Number(d.cantidad),
          );
        }

        // SEGURIDAD 2 (composición): cada instancia debe contener EXACTAMENTE los
        // productos definidos del combo con sus cantidades. Evita fusionar N combos
        // en una instancia para pagar uno solo, o agregar unidades extra a $0.
        for (const [key, grupo] of gruposInstancia) {
          const esperado = comboMap.get(grupo.comboId)!.esperado;
          if (grupo.cantidades.size !== esperado.size) {
            throw new BadRequestException(
              `La instancia de combo ${key} no coincide con la composición del combo ${grupo.comboId}`,
            );
          }
          for (const [productoId, qtyEsperada] of esperado) {
            if ((grupo.cantidades.get(productoId) ?? 0) !== qtyEsperada) {
              throw new BadRequestException(
                `La instancia de combo ${key} no coincide con la composición del combo ${grupo.comboId}`,
              );
            }
          }
          // Id de instancia persistido: el del cliente si vino, si no uno del server.
          instanciaStoredId.set(key, grupo.comboInstanciaId || randomUUID());
        }
      }

      // Marca qué instancias ya asignaron su "primera línea" (la del precio fijo).
      const comboPrimeraLineaAsignada = new Set<string>();

      const extraIds = detalles
        .flatMap((d) => (d as any).extras ?? [])
        .map((e: any) => e.extraId);
      const extrasUnicos = Array.from(new Set(extraIds));

      const extrasDb = extrasUnicos.length
        ? await tx.extra.findMany({
            where: { id: { in: extrasUnicos } },
            select: {
              id: true,
              nombre: true,
              precio: true,
              stockActual: true,
              activo: true,
              esPremium: true,
              insumoId: true,
              unidadMedida: true,
              preciosPorCategoria: true,
              consumosPorCategoria: true,
            },
          })
        : [];

      const extraMap = new Map(
        extrasDb.map((e) => [
          e.id,
          {
            ...e,
            precio: Number(e.precio),
            preciosPorCategoria: e.preciosPorCategoria,
            consumosPorCategoria: e.consumosPorCategoria,
          },
        ]),
      );

      const todosLosAderezosIds = detalles.flatMap(
        (d) => (d as any).aderezosIds ?? [],
      );

      const aderezosDb =
        todosLosAderezosIds.length > 0
          ? await tx.aderezo.findMany({
              where: { id: { in: todosLosAderezosIds } },
              select: {
                id: true,
                nombre: true,
                stockActual: true,
                activo: true,
                unidadMedida: true,
                consumosPorCategoria: true,
              },
            })
          : [];

      const aderezoMap = new Map(
        aderezosDb.map((a) => [
          a.id,
          {
            ...a,
            stockActual: Number(a.stockActual),
            consumosPorCategoria: a.consumosPorCategoria,
          },
        ]),
      );

      for (const adeId of todosLosAderezosIds) {
        if (!aderezoMap.has(adeId)) {
          throw new BadRequestException(`Aderezo no encontrado: ${adeId}`);
        }
        const ade = aderezoMap.get(adeId)!;
        if (!ade.activo) {
          throw new BadRequestException(`Aderezo inactivo: ${ade.nombre}`);
        }
        if (ade.stockActual <= 0) {
          throw new BadRequestException(`Sin stock de aderezo: ${ade.nombre}`);
        }
      }

      const stockChecks: { insumoId: string; requerido: number }[] = [];

      for (const d of detalles as any[]) {
        const cantidad = Number(d.cantidad);
        const prod = prodMap.get(d.productoId)!;

        if (prod.receta && prod.receta.length > 0) {
          for (const recetaItem of prod.receta) {
            const requerido = recetaItem.cantidad * cantidad;
            stockChecks.push({
              insumoId: recetaItem.insumoId,
              requerido,
            });
          }
        }

        if (d.extras && Array.isArray(d.extras)) {
          for (const e of d.extras) {
            const extra = extraMap.get(e.extraId);
            if (!extra)
              throw new BadRequestException(
                `Extra no encontrado: ${e.extraId}`,
              );
            if (!extra.activo)
              throw new BadRequestException(`Extra inactivo: ${e.extraId}`);
            const cantidadExtra = e.cantidad ?? 1;

            const cantidadConsumo = this.getExtraConsumo(extra, prod.categoriaId);
            const cantidadTotal = cantidadConsumo * cantidadExtra;

            const stockDisponible = extra.insumoId
              ? ((
                  await tx.insumo.findUnique({
                    where: { id: extra.insumoId },
                    select: { stockActual: true },
                  })
                )?.stockActual ?? 0)
              : extra.stockActual;

            if (stockDisponible < cantidadTotal) {
              throw new BadRequestException(
                `Stock insuficiente para extra ${extra.nombre}. Disponible: ${stockDisponible}, Necesario: ${cantidadTotal}`,
              );
            }
          }
        }

        const cantidadAderezos = d.aderezosIds?.length || 0;
        for (const adeId of d.aderezosIds || []) {
          const ade = aderezoMap.get(adeId);
          const cantidadConsumo = this.getAderezoConsumo(ade, prod.categoriaId);
          const cantidadTotal = cantidadConsumo * cantidad;
          if (ade && ade.stockActual < cantidadTotal) {
            throw new BadRequestException(
              `Stock insuficiente de aderezo ${ade.nombre}. Disponible: ${ade.stockActual}, Necesario: ${cantidadTotal}`,
            );
          }
        }
      }

      const insumoIds = [...new Set(stockChecks.map((s) => s.insumoId))];
      const insumosActuales = await tx.insumo.findMany({
        where: { id: { in: insumoIds } },
        select: { id: true, stockActual: true, nombre: true },
      });

      const stockPorInsumo = new Map(
        insumosActuales.map((i) => [i.id, Number(i.stockActual)]),
      );

      const stockRequeridoPorInsumo = new Map<string, number>();
      for (const check of stockChecks) {
        const actual = stockRequeridoPorInsumo.get(check.insumoId) || 0;
        stockRequeridoPorInsumo.set(check.insumoId, actual + check.requerido);
      }

      for (const [insumoId, requerido] of stockRequeridoPorInsumo) {
        const disponible = stockPorInsumo.get(insumoId) || 0;
        if (disponible < requerido) {
          const insumo = insumosActuales.find((i) => i.id === insumoId);
          throw new BadRequestException(
            `Stock insuficiente de ${insumo?.nombre || insumoId}. Disponible: ${disponible}, Requerido: ${requerido}`,
          );
        }
      }

      let totalNuevosItems = 0;
      const detallesCreate: Prisma.PedidoDetalleCreateWithoutPedidoInput[] = [];

      // Track extras and aderezos with their consumption amounts per category
      const todosLosExtras: { extraId: string; cantidad: number; categoriaId: string | null }[] = [];
      const todosLosAderezosDescontar: {
        aderezoId: string;
        cantidad: number;
        categoriaId: string | null;
      }[] = [];

      for (const d of detalles as any[]) {
        const base = prodMap.get(d.productoId)!;
        const cantidad = Number(d.cantidad);
        const categoriaId = base.categoriaId;
        const limiteExtrasGratis = base.cantExtrasGratis;

        // SEGURIDAD: el precio SIEMPRE sale del servidor, nunca del cliente.
        // `d.precioUnitario` del DTO se ignora deliberadamente.
        // - Línea normal: precio del producto en la DB.
        // - Línea de combo: la 1ra línea del comboId lleva oferta.precio (precio fijo);
        //   las siguientes del mismo comboId van en $0.
        let precioUnitario = base.precio;
        let comboInstanciaId: string | null = null;
        let comboNombre: string | null = null;
        if (d.comboId) {
          const def = comboMap.get(d.comboId)!;
          const key = claveInstancia(d);
          comboInstanciaId = instanciaStoredId.get(key)!;
          comboNombre = def.nombre;
          if (comboPrimeraLineaAsignada.has(key)) {
            precioUnitario = 0;
          } else {
            precioUnitario = def.precio;
            comboPrimeraLineaAsignada.add(key);
          }
        }

        const extrasDto = Array.isArray(d.extras) ? d.extras : [];
        const sinExtras = d.sinExtras === true;

        const extrasNorm = extrasDto.map((e) => ({
          extraId: String(e.extraId),
          cantidad: e.cantidad ?? 1,
        }));

        extrasNorm.forEach((e) => {
          todosLosExtras.push({ ...e, categoriaId });
        });

        let extrasCobradoTotal = 0;
        const extrasJsonArr: any[] = [];

        const expanded: { extraId: string; extra: any }[] = [];
        extrasNorm.forEach((e) => {
          const extra = extraMap.get(e.extraId);
          if (extra) {
            for (let i = 0; i < e.cantidad; i++) {
              expanded.push({ extraId: e.extraId, extra });
            }
          }
        });

        let gratisCount = 0;
        for (let idx = 0; idx < expanded.length; idx++) {
          const { extraId, extra } = expanded[idx];
          const precioExtra = this.getExtraPrecio(extra, categoriaId);
          const esPremium = extra.esPremium === true;
          const cobrado = esPremium || gratisCount >= limiteExtrasGratis;
          if (!esPremium) gratisCount++;
          const precioFinal = cobrado ? precioExtra : 0;
          extrasCobradoTotal += precioFinal;
          extrasJsonArr.push({
            id: extraId,
            nombre: extra.nombre,
            precio: precioExtra,
            cobrado,
          });
        }

        const subtotal = precioUnitario * cantidad + extrasCobradoTotal;
        totalNuevosItems += subtotal;

        const extrasJson: Prisma.InputJsonValue | undefined =
          extrasJsonArr.length > 0 ? (extrasJsonArr as any) : undefined;

        const aderezosIds: string[] = Array.isArray(d.aderezosIds)
          ? d.aderezosIds
          : [];

        for (const adeId of aderezosIds) {
          todosLosAderezosDescontar.push({ aderezoId: adeId, cantidad, categoriaId });
        }

        detallesCreate.push({
          cantidad,
          precioUnitario,
          extras: extrasJson,
          subtotal,
          notas: d.notas?.trim?.() || null,
          sinExtras,
          comboId: d.comboId || null,
          comboInstanciaId,
          comboNombre,
          producto: { connect: { id: d.productoId } },
          aderezos:
            aderezosIds.length > 0
              ? { connect: aderezosIds.map((id) => ({ id })) }
              : undefined,
        });
      }

      // El descuento de stock se realiza una sola vez despues de crear el pedido
      // (ver bloque de auditoria con stockMovimiento mas abajo)
      // Las líneas de combo se EXCLUYEN del cálculo de ofertas automáticas:
      // ya tienen su precio fijo, no deben recibir descuentos adicionales (2x1, %, etc.).
      const lineasParaCalcular = (detalles as any[])
        .filter((d) => !d.comboId)
        .map((d: any) => ({
        productoId: d.productoId,
        cantidad: d.cantidad,
        // SEGURIDAD: precio real de la DB, nunca el del cliente (ver nota arriba).
        precioUnitario: prodMap.get(d.productoId)!.precio,
        extras: (d.extras || []).map((e: any) => ({
          extraId: e.extraId,
          cantidad: e.cantidad ?? 1,
          precio: this.getExtraPrecio(
            extraMap.get(e.extraId),
            prodMap.get(d.productoId)?.categoriaId,
          ),
        })),
      }));

      const calculoOfertas =
        await this.ofertasCalculator.calcularTotal(lineasParaCalcular);

      const totalConOfertas = totalNuevosItems - calculoOfertas.descuento;

      const includeConfig = {
        detalles: {
          include: {
            producto: true,
            aderezos: true,
          },
        },
      };

      let pedidoResult: any;

      if (pedidoId) {
        const pedido = await tx.pedido.findUnique({
          where: { id: pedidoId },
          select: {
            id: true,
            estado: true,
            nombreCliente: true,
            apellidoCliente: true,
            numeroCliente: true,
            metodoPago: true,
            trackingCode: true,
          },
        });

        if (!pedido) throw new NotFoundException('Pedido no encontrado');
        this.verificarTrackingAcceso(
          pedido.trackingCode,
          dto.trackingCode,
          esEmpleado,
        );
        if (!ESTADOS_ABIERTOS.includes(pedido.estado))
          throw new BadRequestException('Pedido cerrado');

        pedidoResult = await tx.pedido.update({
          where: { id: pedidoId },
          data: {
            total: { increment: totalConOfertas },
            detalles: { create: detallesCreate },
            ...(!pedido.nombreCliente && nombreClienteLimpio
              ? { nombreCliente: nombreClienteLimpio }
              : {}),
            ...(!pedido.apellidoCliente && apellidoClienteLimpio
              ? { apellidoCliente: apellidoClienteLimpio }
              : {}),
            ...(!pedido.numeroCliente && numeroClienteLimpio
              ? { numeroCliente: numeroClienteLimpio }
              : {}),
            ...(!pedido.metodoPago && metodoPago
              ? { metodoPago: metodoPago as MetodoPago }
              : {}),
            // Agregar items a un pedido existente: solo un empleado puede tocar el costoEnvio.
            ...(esEmpleado && costoEnvio !== undefined ? { costoEnvio } : {}),
            ...(direccionLat !== undefined ? { direccionLat } : {}),
            ...(direccionLng !== undefined ? { direccionLng } : {}),
            ...(direccionFormateada !== undefined ? { direccionFormateada } : {}),
            ...(piso !== undefined ? { piso } : {}),
            ...(departamento !== undefined ? { departamento } : {}),
            ...(referencias !== undefined ? { referencias } : {}),
            ...(notasRepartidor !== undefined ? { notasRepartidor } : {}),
            ...(shippingZoneName !== undefined ? { shippingZoneName } : {}),
            ...(shippingReason !== undefined ? { shippingReason } : {}),
            ...(direccionPrecision !== undefined ? { direccionPrecision } : {}),
            ...(dto.repartidorId !== undefined ? { repartidorId: dto.repartidorId } : {}),
          },
          include: includeConfig,
        });
      } else {
        const trackingCode = await this.generarTrackingCode(tx);
        pedidoResult = await tx.pedido.create({
          data: {
            tipo,
            trackingCode,
            nombreCliente: nombreClienteLimpio!,
            apellidoCliente: apellidoClienteLimpio,
            metodoPago: (metodoPago as MetodoPago) ?? null,
            numeroCliente: numeroClienteLimpio,
            direccion: tipo === TipoPedidoDto.DELIVERY ? direccion!.trim() : null,
            costoEnvio: esEmpleado ? (costoEnvio ?? 0) : costoEnvioPublico,
            direccionLat: direccionLat ?? null,
            direccionLng: direccionLng ?? null,
            direccionFormateada: direccionFormateada ?? null,
            piso: piso ?? null,
            departamento: departamento ?? null,
            referencias: referencias ?? null,
            notasRepartidor: notasRepartidor ?? null,
            shippingZoneName: shippingZoneName ?? null,
            shippingReason: shippingReason ?? null,
            direccionPrecision: direccionPrecision ?? null,
            repartidorId: dto.repartidorId ?? null,
            total: totalConOfertas,
            estado: EstadoPedido.PENDIENTE,
            demoraMinutosSnapshot: demoraSnapshot,
            detalles: { create: detallesCreate },
          },
          include: includeConfig,
        });
      }

      // ✅ Descontar stock de extras con registro de movimientos
      for (const e of todosLosExtras) {
        const extra = await tx.extra.findUnique({
          where: { id: e.extraId },
          select: { id: true, insumoId: true, stockActual: true, nombre: true, unidadMedida: true },
        });

        if (!extra) {
          throw new BadRequestException(`Extra no encontrado: ${e.extraId}`);
        }

        // Calcular consumo según categoría del producto
        const extraData = extraMap.get(e.extraId);
        const cantidadConsumo = this.getExtraConsumo(extraData, e.categoriaId);
        const cantidadTotalDescontar = cantidadConsumo * e.cantidad;

        if (extra.insumoId) {
          const insumo = await tx.insumo.findUnique({
            where: { id: extra.insumoId },
            select: { stockActual: true, nombre: true },
          });
          const stockAntes = Number(insumo?.stockActual ?? 0);

          const result = await tx.insumo.updateMany({
            where: {
              id: extra.insumoId,
              stockActual: { gte: cantidadTotalDescontar },
            },
            data: {
              stockActual: { decrement: cantidadTotalDescontar },
            },
          });

          if (result.count === 0) {
            throw new BadRequestException(
              `Stock insuficiente para extra ${extra.nombre} (insumo: ${insumo?.nombre || extra.insumoId}). ` +
                `Disponible: ${stockAntes}, Solicitado: ${cantidadTotalDescontar}`,
            );
          }

          await tx.stockMovimiento.create({
            data: {
              insumoId: extra.insumoId,
              tipo: 'DESCUENTO_PEDIDO',
              cantidad: -cantidadTotalDescontar,
              stockAntes,
              stockDespues: stockAntes - cantidadTotalDescontar,
              pedidoId: pedidoResult.id,
              motivo: `Consumo por extra: ${extra.nombre} (${cantidadConsumo}${extra.unidadMedida || 'un'} x ${e.cantidad})`,
            },
          });
        } else {
          const stockAntes = Number(extra.stockActual ?? 0);

          const result = await tx.extra.updateMany({
            where: {
              id: e.extraId,
              stockActual: { gte: cantidadTotalDescontar },
            },
            data: {
              stockActual: { decrement: cantidadTotalDescontar },
            },
          });

          if (result.count === 0) {
            throw new BadRequestException(
              `Stock insuficiente para extra ${extra.nombre}. ` +
                `Disponible: ${stockAntes}, Solicitado: ${cantidadTotalDescontar}`,
            );
          }

          await tx.stockMovimiento.create({
            data: {
              extraId: e.extraId,
              tipo: 'DESCUENTO_PEDIDO',
              cantidad: -cantidadTotalDescontar,
              stockAntes,
              stockDespues: stockAntes - cantidadTotalDescontar,
              pedidoId: pedidoResult.id,
              motivo: `Consumo por extra: ${extra.nombre} (${cantidadConsumo}${extra.unidadMedida || 'un'} x ${e.cantidad})`,
            },
          });
        }
      }

      // ✅ Descontar stock de aderezos con registro de movimientos
      for (const item of todosLosAderezosDescontar) {
        const aderezoData = aderezoMap.get(item.aderezoId);
        const cantidadConsumo = this.getAderezoConsumo(aderezoData, item.categoriaId);
        const cantidadTotalDescontar = cantidadConsumo * item.cantidad;

        const aderezo = await tx.aderezo.findUnique({
          where: { id: item.aderezoId },
          select: { nombre: true, stockActual: true, unidadMedida: true },
        });
        const stockAntes = Number(aderezo?.stockActual ?? 0);

        const result = await tx.aderezo.updateMany({
          where: {
            id: item.aderezoId,
            stockActual: { gte: cantidadTotalDescontar },
          },
          data: {
            stockActual: { decrement: cantidadTotalDescontar },
          },
        });

        if (result.count === 0) {
          throw new BadRequestException(
            `Stock insuficiente de aderezo ${aderezo?.nombre || item.aderezoId}. ` +
              `Disponible: ${stockAntes}, Necesario: ${cantidadTotalDescontar}`,
          );
        }

        await tx.stockMovimiento.create({
          data: {
            aderezoId: item.aderezoId,
            tipo: 'DESCUENTO_PEDIDO',
            cantidad: -cantidadTotalDescontar,
            stockAntes,
            stockDespues: stockAntes - cantidadTotalDescontar,
            pedidoId: pedidoResult.id,
            motivo: `Consumo por aderezo: ${aderezo?.nombre} (${cantidadConsumo}${aderezo?.unidadMedida || 'un'} x ${item.cantidad})`,
          },
        });
      }

      // ✅ Descontar stock de recetas con registro de movimientos
      for (const [insumoId, requerido] of stockRequeridoPorInsumo) {
        const insumo = await tx.insumo.findUnique({
          where: { id: insumoId },
          select: { stockActual: true, nombre: true },
        });
        const stockAntes = Number(insumo?.stockActual ?? 0);

        const result = await tx.insumo.updateMany({
          where: {
            id: insumoId,
            stockActual: { gte: requerido },
          },
          data: {
            stockActual: { decrement: requerido },
          },
        });

        if (result.count === 0) {
          throw new BadRequestException(
            `Stock insuficiente de ${insumo?.nombre || insumoId}. ` +
              `Disponible: ${stockAntes}, Requerido: ${requerido}`,
          );
        }

        await tx.stockMovimiento.create({
          data: {
            insumoId,
            tipo: 'DESCUENTO_PEDIDO',
            cantidad: -requerido,
            stockAntes,
            stockDespues: stockAntes - requerido,
            pedidoId: pedidoResult.id,
            motivo: 'Consumo por pedido',
          },
        });
      }

      await this.registrarOfertasAplicadas(tx, pedidoResult.id, calculoOfertas);

      if (origen === 'MENU') {
        this.pedidosGateway.notificarNuevoPedido({
          id: pedidoResult.id,
          nombreCliente: pedidoResult.nombreCliente || nombreClienteLimpio || '',
          apellidoCliente: pedidoResult.apellidoCliente || apellidoClienteLimpio || '',
          numeroCliente: pedidoResult.numeroCliente || numeroClienteLimpio || '',
          tipo,
          total: pedidoResult.total,
        });
      }

      // Sin importar el origen: el monitor de las demas terminales tiene que
      // enterarse. Es solo un aviso "refresca", asi que si la transaccion
      // fallara despues, lo peor que pasa es un refetch de mas.
      this.pedidosGateway.notificarCambioPedidos('pedido-creado', pedidoResult.id);

      return pedidoResult;
    });
  }

  /**
   * Genera un trackingCode único (48 bits, url-safe) para un pedido nuevo.
   * Reintenta ante una colisión de la constraint unique (probabilidad ~1 en 2^48).
   */
  private async generarTrackingCode(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    for (let intento = 0; intento < 3; intento++) {
      const code = randomBytes(6).toString('base64url');
      const existente = await tx.pedido.findUnique({
        where: { trackingCode: code },
        select: { id: true },
      });
      if (!existente) return code;
    }
    throw new Error('No se pudo generar un trackingCode único');
  }

  /**
   * Verifica el acceso de tracking a un pedido cuando quien llama no es un
   * empleado autenticado (ADMIN/TRABAJADOR). Los pedidos creados antes de
   * introducir este campo tienen `trackingCode = null` y quedan accesibles
   * solo por `id` (no se migran retroactivamente para no romper links ya
   * compartidos con clientes).
   */
  private verificarTrackingAcceso(
    trackingCode: string | null,
    code: string | undefined,
    esEmpleado?: boolean,
  ): void {
    if (!tieneAccesoTracking(trackingCode, code, esEmpleado)) {
      throw new NotFoundException('Pedido no encontrado');
    }
  }

  private getExtraPrecio(
    extra: any,
    categoriaId: string | null | undefined,
  ): number {
    if (!extra) return 0;

    if (extra.preciosPorCategoria && categoriaId) {
      const precioEspecifico = extra.preciosPorCategoria.find(
        (p: any) => p.categoriaId === categoriaId,
      );
      if (precioEspecifico) {
        return Number(precioEspecifico.precio);
      }
    }

    return Number(extra.precio);
  }

  private getExtraConsumo(
    extra: any,
    categoriaId: string | null | undefined,
  ): number {
    if (!extra) return 1;

    if (extra.consumosPorCategoria && categoriaId) {
      const consumoEspecifico = extra.consumosPorCategoria.find(
        (c: any) => c.categoriaId === categoriaId,
      );
      if (consumoEspecifico) {
        return Number(consumoEspecifico.cantidadConsumo);
      }
    }

    this.logger.warn(`[STOCK] Extra ${extra.nombre} no tiene configuración de consumo para categoría ${categoriaId}. Usando default=1`);
    return 1;
  }

  private getAderezoConsumo(
    aderezo: any,
    categoriaId: string | null | undefined,
  ): number {
    if (!aderezo) return 1;

    if (aderezo.consumosPorCategoria && categoriaId) {
      const consumoEspecifico = aderezo.consumosPorCategoria.find(
        (c: any) => c.categoriaId === categoriaId,
      );
      if (consumoEspecifico) {
        return Number(consumoEspecifico.cantidadConsumo);
      }
    }

    this.logger.warn(`[STOCK] Aderezo ${aderezo.nombre} no tiene configuración de consumo para categoría ${categoriaId}. Usando default=1`);
    return 1;
  }

  private async registrarOfertasAplicadas(
    tx: Prisma.TransactionClient,
    pedidoId: string,
    calculoOfertas: any,
  ) {
    if (calculoOfertas.ofertasAplicadas.length > 0) {
      for (const ofertaAplicada of calculoOfertas.ofertasAplicadas) {
        await tx.pedidoOferta.create({
          data: {
            pedidoId,
            ofertaId: ofertaAplicada.ofertaId,
            precioOriginal: calculoOfertas.subtotal,
            precioFinal: calculoOfertas.total,
            descuentoAplicado: ofertaAplicada.descuento,
          },
        });
        await tx.oferta.update({
          where: { id: ofertaAplicada.ofertaId },
          data: { usosActuales: { increment: 1 } },
        });
      }
    }
  }

  async getDemoraActual(): Promise<{ modo: 'AUTO' | 'MANUAL'; minutos: number; pedidosActivos: number }> {
    const modo = (await this.configService.obtener('demora_modo')) ?? 'AUTO';

    const pedidosActivos = await this.prisma.pedido.count({
      where: { estado: { in: [EstadoPedido.PENDIENTE, EstadoPedido.EN_PREPARACION] } },
    });

    if (modo === 'MANUAL') {
      const raw = await this.configService.obtener('demora_manual_minutos');
      const minutos = parseInt(raw ?? '0', 10);
      return { modo: 'MANUAL', minutos, pedidosActivos };
    }

    let minutos = 0;
    if (pedidosActivos >= 13) minutos = 50;
    else if (pedidosActivos >= 9) minutos = 35;
    else if (pedidosActivos >= 5) minutos = 20;

    return { modo: 'AUTO', minutos, pedidosActivos };
  }

  async setDemoraManual(dto: { modo: 'AUTO' | 'MANUAL'; minutos?: number }): Promise<{ modo: 'AUTO' | 'MANUAL'; minutos: number; pedidosActivos: number }> {
    await this.configService.establecer('demora_modo', dto.modo);
    await this.configService.establecer(
      'demora_manual_minutos',
      String(dto.modo === 'MANUAL' ? (dto.minutos ?? 0) : 0),
    );
    return this.getDemoraActual();
  }

  async listarTodos() {
    return this.prisma.pedido.findMany({
      include: {
        detalles: {
          include: {
            producto: true,
            aderezos: true,
          },
        },
        repartidor: { select: { nombre: true, role: true } },
        movimientosCaja: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Pedidos que el monitor del POS tiene abiertos en pantalla.
   *
   * A diferencia de `listarTodos()`, que devuelve el histórico COMPLETO con
   * todas las relaciones anidadas para que el cliente filtre, acá el filtro es
   * server-side y el `select` trae solo los campos que el monitor renderiza
   * (más los que necesita el ticket de impresión, que recibe el pedido tal
   * cual). El payload queda acotado: crece con los pedidos abiertos, no con el
   * histórico.
   *
   * Se excluyen a propósito: `movimientosCaja` (el monitor no los muestra),
   * el objeto `producto` entero (solo hace falta el nombre) y los campos de
   * geocoding/envío, que no se renderizan acá.
   *
   * Además de las columnas, cada fila lleva `minutosTranscurridos` y
   * `demorado`, derivados en el server (ver abajo). Son campos AGREGADOS: no
   * cambian nada de lo que /pos/monitor ya leía.
   */
  async listarActivos() {
    const pedidos = await this.prisma.pedido.findMany({
      where: { estado: { in: ESTADOS_MONITOR } },
      select: {
        id: true,
        tipo: true,
        estado: true,
        total: true,
        costoEnvio: true,
        createdAt: true,
        nombreCliente: true,
        apellidoCliente: true,
        numeroCliente: true,
        metodoPago: true,
        direccion: true,
        repartidorId: true,
        repartidor: { select: { id: true, nombre: true } },
        detalles: {
          select: {
            id: true,
            cantidad: true,
            subtotal: true,
            precioUnitario: true,
            notas: true,
            sinExtras: true,
            extras: true,
            comboId: true,
            comboInstanciaId: true,
            comboNombre: true,
            producto: { select: { id: true, nombre: true } },
            aderezos: { select: { id: true, nombre: true } },
          },
        },
      },
      // El monitor ordena por fecha ascendente (lo más viejo primero, que es
      // lo que hay que despachar). Se ordena acá para que llegue listo.
      orderBy: { createdAt: 'asc' },
    });

    // Campos derivados, calculados por fila sobre lo ya traído: no agregan
    // ninguna query. Se resuelven acá y no en el cliente para que las dos
    // pantallas que los consumen (monitor y Home) usen el mismo criterio de
    // "demorado" y el mismo reloj: el del servidor.
    //
    // Se toma UN `ahora` para todo el lote, así dos pedidos creados en el
    // mismo instante no difieren por los milisegundos del recorrido.
    const ahora = new Date();
    return pedidos.map((pedido) => {
      const minutosTranscurridos = minutosDesde(pedido.createdAt, ahora);
      return {
        ...pedido,
        minutosTranscurridos,
        demorado: minutosTranscurridos >= MINUTOS_PEDIDO_DEMORADO,
      };
    });
  }

  /**
   * Plata ya facturada que todavía no entró a caja.
   *
   * Es un `aggregate` con filtro por relación: Prisma soporta `movimientosCaja:
   * { none: ... }` dentro del `where` de un aggregate, así que la suma la hace
   * Postgres y no viaja ninguna fila. La regla ("no cancelado y sin ENTRADA en
   * caja") es la misma que la pantalla de Caja aplica hoy en el cliente.
   */
  async getPendienteCobro() {
    const { _sum } = await this.prisma.pedido.aggregate({
      where: {
        estado: { not: EstadoPedido.CANCELADO },
        movimientosCaja: { none: { tipo: TipoMovimientoCaja.ENTRADA } },
      },
      _sum: { total: true, costoEnvio: true },
    });

    return (_sum.total ?? 0) + (_sum.costoEnvio ?? 0);
  }

  /**
   * Pedidos DELIVERY con plata sin confirmar. Devuelve los totales reales del
   * conjunto (para el contador y el botón "Confirmar todos") pero solo las
   * primeras `limite` filas, que son las que se muestran en la grilla.
   */
  async getDeliveryPendientesConfirmar(limite = 3) {
    const where = {
      tipo: TipoPedidoDto.DELIVERY,
      estado: { not: EstadoPedido.CANCELADO },
      movimientosCaja: { none: { tipo: TipoMovimientoCaja.ENTRADA } },
    };

    const [agregado, items] = await Promise.all([
      this.prisma.pedido.aggregate({
        where,
        _count: { _all: true },
        _sum: { total: true, costoEnvio: true },
      }),
      this.prisma.pedido.findMany({
        where,
        select: {
          id: true,
          estado: true,
          total: true,
          costoEnvio: true,
          createdAt: true,
          nombreCliente: true,
          apellidoCliente: true,
        },
        orderBy: { createdAt: 'asc' },
        take: limite,
      }),
    ]);

    return {
      total: agregado._count._all,
      montoTotal: (agregado._sum.total ?? 0) + (agregado._sum.costoEnvio ?? 0),
      items: items.map((p) => ({
        ...p,
        codigo: codigoPedido(p.id),
        montoAConfirmar: (p.total ?? 0) + (p.costoEnvio ?? 0),
      })),
    };
  }

  /**
   * Facturación por día de los últimos `dias`, para el gráfico del Home.
   *
   * Va en `$queryRaw` porque `groupBy` de Prisma solo agrupa por columnas
   * enteras, y acá hace falta truncar el timestamp al día. `createdAt` es
   * `TIMESTAMP(3)` sin zona guardando UTC (convención de Prisma), así que se
   * lo reinterpreta como UTC y recién ahí se pasa a hora local: sin ese doble
   * `AT TIME ZONE`, los pedidos de la madrugada caerían en el día anterior.
   *
   * Los días sin ventas no vuelven de la query; se rellenan con 0 acá para que
   * el gráfico no se deforme.
   *
   * El día vuelve ya formateado como texto (`to_char`) y no como timestamp a
   * propósito: `date_trunc` devuelve `timestamp without time zone`, y el
   * driver lo hidrata como `Date` interpretándolo en UTC. En un server en
   * UTC-3 eso convertía el 11/07 00:00 local en el 10/07 21:00, la clave del
   * Map caía en el día anterior y NINGUNA fila matcheaba contra las claves
   * que arma el relleno de abajo: el gráfico salía en cero aunque hubiera
   * ventas. Con `to_char` no hay Date de por medio y no hay nada que se corra.
   */
  async getFacturacionPorDia(dias = 7, ahora: Date = new Date()) {
    const inicio = inicioVentanaDias(dias, ahora);

    const filas = await this.prisma.$queryRaw<
      Array<{ dia: string; monto: number | null; pedidos: bigint }>
    >`
      SELECT
        to_char(
          date_trunc(
            'day',
            ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${ZONA_HORARIA_NEGOCIO}
          ),
          'YYYY-MM-DD'
        ) AS dia,
        SUM("total" + "costoEnvio") AS monto,
        COUNT(*) AS pedidos
      FROM "Pedido"
      WHERE "estado" = 'ENTREGADO'
        AND "createdAt" >= ${inicio}
      GROUP BY dia
      ORDER BY dia ASC
    `;

    const porDia = new Map(
      filas.map((f) => [
        f.dia,
        { monto: Number(f.monto ?? 0), pedidos: Number(f.pedidos) },
      ]),
    );

    const resultado: Array<{
      fecha: string;
      label: string;
      monto: number;
      pedidos: number;
    }> = [];

    for (let i = 0; i < dias; i++) {
      const fecha = new Date(inicio);
      fecha.setDate(inicio.getDate() + i);
      const clave = claveFecha(fecha);
      const datos = porDia.get(clave) ?? { monto: 0, pedidos: 0 };
      resultado.push({
        fecha: clave,
        label: fecha
          .toLocaleDateString('es-AR', { weekday: 'short' })
          .replace('.', ''),
        monto: datos.monto,
        pedidos: datos.pedidos,
      });
    }

    return {
      dias: resultado,
      total: resultado.reduce((acc, d) => acc + d.monto, 0),
      max: Math.max(...resultado.map((d) => d.monto), 0),
    };
  }

  async listarDeliveryPendientes() {
    return this.prisma.pedido.findMany({
      where: {
        tipo: TipoPedidoDto.DELIVERY,
        estado: { in: ESTADOS_ABIERTOS },
      },
      include: {
        detalles: { include: { producto: true } },
        repartidor: { select: { nombre: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(id: string, code?: string, esEmpleado?: boolean) {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id },
      include: {
        detalles: {
          include: {
            producto: {
              select: {
                id: true,
                nombre: true,
                precio: true,
                tiempoPreparacionMin: true,
                categoriaId: true,
                categoria: true,
              },
            },
            aderezos: true,
          },
        },
        repartidor: { select: { id: true, nombre: true } },
        movimientosCaja: true,
      },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    this.verificarTrackingAcceso(pedido.trackingCode, code, esEmpleado);
    return pedido;
  }

  async cambiarEstado(id: string, nuevoEstado: EstadoPedido) {
    const pedidoExistente = await this.prisma.pedido.findUnique({
      where: { id },
      select: { id: true, estado: true, tipo: true },
    });

    if (!pedidoExistente) {
      throw new NotFoundException(`El pedido con ID ${id} no existe`);
    }

    if (
      pedidoExistente.estado === EstadoPedido.ENTREGADO ||
      pedidoExistente.estado === EstadoPedido.CANCELADO
    ) {
      throw new BadRequestException(
        'No se puede cambiar estado de un pedido cerrado',
      );
    }

    // Transiciones según tipo de pedido
    const transicionesDelTipo = this.getTransicionesPorTipo(pedidoExistente.tipo as TipoPedidoDto, pedidoExistente.estado);
    if (!transicionesDelTipo.includes(nuevoEstado)) {
      throw new BadRequestException(
        `No se puede pasar de ${pedidoExistente.estado} a ${nuevoEstado}. Transiciones permitidas: ${transicionesDelTipo.join(', ')}`,
      );
    }

    const actualizado = await this.prisma.pedido.update({
      where: { id },
      data: { estado: nuevoEstado },
    });
    this.pedidosGateway.notificarActualizacionPedido(id, {
      estado: actualizado.estado,
    });
    this.pedidosGateway.notificarCambioPedidos('estado-cambiado', id);
    return actualizado;
  }

  private getTransicionesPorTipo(tipo: TipoPedidoDto, estadoActual: EstadoPedido): EstadoPedido[] {
    // DELIVERY: PENDIENTE -> EN_CAMINO directo permitido
    if (tipo === TipoPedidoDto.DELIVERY) {
      switch (estadoActual) {
        case EstadoPedido.PENDIENTE:
          return [EstadoPedido.EN_PREPARACION, EstadoPedido.EN_CAMINO, EstadoPedido.CANCELADO];
        case EstadoPedido.EN_PREPARACION:
          return [EstadoPedido.EN_CAMINO, EstadoPedido.CANCELADO];
        case EstadoPedido.EN_CAMINO:
          return [EstadoPedido.ENTREGADO, EstadoPedido.PROBLEMA_DIRECCION, EstadoPedido.CANCELADO];
        case EstadoPedido.PROBLEMA_DIRECCION:
          return [EstadoPedido.EN_CAMINO, EstadoPedido.CANCELADO];
        default:
          return [];
      }
    }

    // LOCAL / RETIRO: flujo completo con cocina
    return TRANSICIONES_VALIDAS[estadoActual];
  }

  async finalizarPedido(id: string) {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id },
      select: { id: true, estado: true },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    if (pedido.estado === EstadoPedido.ENTREGADO) {
      throw new BadRequestException('El pedido ya está entregado');
    }
    if (pedido.estado === EstadoPedido.CANCELADO) {
      throw new BadRequestException(
        'No se puede finalizar un pedido cancelado',
      );
    }

    const actualizado = await this.prisma.pedido.update({
      where: { id },
      data: { estado: EstadoPedido.ENTREGADO },
    });
    this.pedidosGateway.notificarActualizacionPedido(id, {
      estado: actualizado.estado,
    });
    this.pedidosGateway.notificarCambioPedidos('pedido-finalizado', id);
    return actualizado;
  }

  async cancelarPedido(id: string, motivo: string, rol: Role) {
    return this.prisma.$transaction(async (tx) => {
      const pedido = await tx.pedido.findUnique({
        where: { id },
        select: {
          id: true,
          estado: true,
          detalles: {
            include: {
              producto: {
                select: {
                  id: true,
                  categoriaId: true,
                  receta: {
                    include: { insumo: { select: { id: true } } },
                  },
                },
              },
              aderezos: { select: { id: true } },
            },
          },
        },
      });

      if (!pedido) throw new NotFoundException('Pedido no encontrado');

      if (pedido.estado === EstadoPedido.CANCELADO) {
        throw new BadRequestException('El pedido ya estaba cancelado');
      }
      if (pedido.estado === EstadoPedido.ENTREGADO) {
        throw new BadRequestException(
          'No se puede cancelar un pedido entregado',
        );
      }

      const motivoLimpio = (motivo || '').trim();
      if (!motivoLimpio) throw new BadRequestException('Motivo obligatorio');

      // Pre-load extras and aderezos with their consumosPorCategoria
      const extraIds = new Set<string>();
      const aderezoIds = new Set<string>();

      for (const detalle of pedido.detalles) {
        const extrasJson = detalle.extras as any[] | null;
        if (extrasJson && Array.isArray(extrasJson)) {
          for (const ex of extrasJson) {
            extraIds.add(ex.id);
          }
        }
        for (const aderezo of detalle.aderezos) {
          aderezoIds.add(aderezo.id);
        }
      }

      const extrasDb = extraIds.size > 0
        ? await tx.extra.findMany({
            where: { id: { in: Array.from(extraIds) } },
            select: { id: true, insumoId: true, nombre: true, unidadMedida: true, consumosPorCategoria: true },
          })
        : [];
      const extraMap = new Map(extrasDb.map(e => [e.id, e]));

      const aderezosDb = aderezoIds.size > 0
        ? await tx.aderezo.findMany({
            where: { id: { in: Array.from(aderezoIds) } },
            select: { id: true, nombre: true, unidadMedida: true, stockActual: true, consumosPorCategoria: true },
          })
        : [];
      const aderezoMap = new Map(aderezosDb.map(a => [a.id, a]));

      for (const detalle of pedido.detalles) {
        const categoriaId = detalle.producto.categoriaId;

        // Restaurar stock de extras usando consumo por categoría
        const extrasJson = detalle.extras as any[] | null;
        if (extrasJson && Array.isArray(extrasJson)) {
          const extrasCount = new Map<string, number>();
          for (const ex of extrasJson) {
            const count = extrasCount.get(ex.id) || 0;
            extrasCount.set(ex.id, count + 1);
          }
          for (const [extraId, count] of extrasCount) {
            const extraData = extraMap.get(extraId);
            const cantidadConsumo = this.getExtraConsumo(extraData, categoriaId);
            const cantidadRestaurar = cantidadConsumo * count;

            const extra = await tx.extra.findUnique({
              where: { id: extraId },
              select: { insumoId: true, nombre: true, unidadMedida: true, stockActual: true },
            });

            if (extra?.insumoId) {
              const insumo = await tx.insumo.findUnique({
                where: { id: extra.insumoId },
                select: { stockActual: true, nombre: true },
              });
              const stockAntes = Number(insumo?.stockActual ?? 0);

              await tx.insumo.update({
                where: { id: extra.insumoId },
                data: { stockActual: { increment: cantidadRestaurar } },
              });

              await tx.stockMovimiento.create({
                data: {
                  insumoId: extra.insumoId,
                  tipo: 'REPOSICION',
                  cantidad: cantidadRestaurar,
                  stockAntes,
                  stockDespues: stockAntes + cantidadRestaurar,
                  pedidoId: id,
                  motivo: `Cancelación pedido: reposición extra ${extra.nombre} (${cantidadConsumo}${extra.unidadMedida || 'un'} x ${count})`,
                },
              });
            } else {
              const stockAntes = Number(extra?.stockActual ?? 0);

              await tx.extra.update({
                where: { id: extraId },
                data: { stockActual: { increment: cantidadRestaurar } },
              });

              await tx.stockMovimiento.create({
                data: {
                  extraId,
                  tipo: 'REPOSICION',
                  cantidad: cantidadRestaurar,
                  stockAntes,
                  stockDespues: stockAntes + cantidadRestaurar,
                  pedidoId: id,
                  motivo: `Cancelación pedido: reposición extra ${extra?.nombre} (${cantidadConsumo}${extra?.unidadMedida || 'un'} x ${count})`,
                },
              });
            }
          }
        }

        // Restaurar stock de aderezos usando consumo por categoría
        if (detalle.aderezos && detalle.aderezos.length > 0) {
          for (const aderezo of detalle.aderezos) {
            const aderezoData = aderezoMap.get(aderezo.id);
            const cantidadConsumo = this.getAderezoConsumo(aderezoData, categoriaId);
            const cantidadRestaurar = cantidadConsumo * detalle.cantidad;

            const aderezoDb = await tx.aderezo.findUnique({
              where: { id: aderezo.id },
              select: { nombre: true, stockActual: true, unidadMedida: true },
            });
            const stockAntes = Number(aderezoDb?.stockActual ?? 0);

            await tx.aderezo.update({
              where: { id: aderezo.id },
              data: { stockActual: { increment: cantidadRestaurar } },
            });

            await tx.stockMovimiento.create({
              data: {
                aderezoId: aderezo.id,
                tipo: 'REPOSICION',
                cantidad: cantidadRestaurar,
                stockAntes,
                stockDespues: stockAntes + cantidadRestaurar,
                pedidoId: id,
                motivo: `Cancelación pedido: reposición aderezo ${aderezoDb?.nombre} (${cantidadConsumo}${aderezoDb?.unidadMedida || 'un'} x ${detalle.cantidad})`,
              },
            });
          }
        }

        // Restaurar stock de recetas (insumos)
        if (detalle.producto.receta && detalle.producto.receta.length > 0) {
          for (const recetaItem of detalle.producto.receta) {
            const cantidadRestaurar = recetaItem.cantidad * detalle.cantidad;
            await tx.insumo.update({
              where: { id: recetaItem.insumoId },
              data: { stockActual: { increment: cantidadRestaurar } },
            });
          }
        }
      }

      return tx.pedido.update({
        where: { id },
        data: {
          estado: EstadoPedido.CANCELADO,
          motivoCancelacion: motivoLimpio,
          canceladoPor: rol,
        },
      });
    }).then((actualizado) => {
      this.pedidosGateway.notificarActualizacionPedido(id, {
        estado: actualizado.estado,
      });
      this.pedidosGateway.notificarCambioPedidos('pedido-cancelado', id);
      return actualizado;
    });
  }

  async setPago(id: string, dto: { metodoPago?: any; numeroCliente?: any }) {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id },
      select: { id: true, estado: true },
    });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    if (
      pedido.estado === EstadoPedido.ENTREGADO ||
      pedido.estado === EstadoPedido.CANCELADO
    ) {
      throw new BadRequestException(
        'No se puede cambiar pago de un pedido cerrado',
      );
    }

    const actualizado = await this.prisma.pedido.update({
      where: { id },
      data: {
        metodoPago: dto.metodoPago === undefined ? undefined : dto.metodoPago,
        numeroCliente:
          dto.numeroCliente === undefined
            ? undefined
            : dto.numeroCliente?.trim?.() || null,
      },
    });
    // El monitor muestra el metodo de pago, asi que este cambio tambien
    // tiene que refrescar las otras terminales.
    this.pedidosGateway.notificarCambioPedidos('pago-actualizado', id);
    return actualizado;
  }

  async setCostoEnvio(id: string, costoEnvio: number) {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id },
      select: { id: true, estado: true, tipo: true },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    if (
      pedido.estado === EstadoPedido.ENTREGADO ||
      pedido.estado === EstadoPedido.CANCELADO
    ) {
      throw new BadRequestException(
        'No se puede modificar el costo de envío de un pedido cerrado',
      );
    }

    const costoEnvioNum = Number(costoEnvio);
    if (!Number.isFinite(costoEnvioNum) || costoEnvioNum < 0) {
      throw new BadRequestException(
        'El costo de envío debe ser un número válido mayor o igual a 0',
      );
    }

    const actualizado = await this.prisma.pedido.update({
      where: { id },
      data: { costoEnvio: costoEnvioNum },
    });
    this.pedidosGateway.notificarActualizacionPedido(id, {
      costoEnvio: actualizado.costoEnvio,
    });
    this.pedidosGateway.notificarCambioPedidos('costo-envio-actualizado', id);
    return actualizado;
  }

  async asignarRepartidor(
    id: string,
    dto: { repartidorId?: string; costoEnvio?: number },
  ) {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id },
      select: { id: true, estado: true },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    if (
      pedido.estado === EstadoPedido.ENTREGADO ||
      pedido.estado === EstadoPedido.CANCELADO
    ) {
      throw new BadRequestException(
        'No se puede modificar un pedido cerrado',
      );
    }

    const data: any = {};
    if (dto.repartidorId !== undefined) data.repartidorId = dto.repartidorId || null;
    if (dto.costoEnvio !== undefined) {
      const costo = Number(dto.costoEnvio);
      if (!Number.isFinite(costo) || costo < 0) {
        throw new BadRequestException('Costo de envío inválido');
      }
      data.costoEnvio = costo;
    }

    const actualizado = await this.prisma.pedido.update({
      where: { id },
      data,
      include: {
        repartidor: { select: { id: true, nombre: true } },
      },
    });
    this.pedidosGateway.notificarActualizacionPedido(id, {
      repartidorId: actualizado.repartidorId,
      repartidor: actualizado.repartidor,
      costoEnvio: actualizado.costoEnvio,
    });
    this.pedidosGateway.notificarCambioPedidos('repartidor-asignado', id);
    return actualizado;
  }
}
