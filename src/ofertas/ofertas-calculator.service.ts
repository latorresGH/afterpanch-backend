import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TipoOferta, EstadoOferta } from '@prisma/client';

export interface LineaCalculo {
  productoId: string;
  cantidad: number;
  precioUnitario: number;
  extras?: { extraId: string; cantidad: number; precio: number }[];
}

export interface OfertaAplicada {
  ofertaId: string;
  nombre: string;
  tipo: string;
  descuento: number;
  lineasAfectadas: { detalleIdx: number; descuentoLinea: number }[];
}

export interface ResultadoCalculo {
  subtotal: number;
  descuento: number;
  total: number;
  ofertasAplicadas: OfertaAplicada[];
}

@Injectable()
export class OfertasCalculatorService {
  constructor(private prisma: PrismaService) {}

  async calcularTotal(lineas: LineaCalculo[]): Promise<ResultadoCalculo> {
    const ahora = new Date();
    const diaSemana = ahora.getDay() === 0 ? 7 : ahora.getDay();
    const horaActual = ahora.toTimeString().slice(0, 5);

    const ofertasActivas = await this.prisma.oferta.findMany({
      where: {
        activa: true,
        estado: EstadoOferta.ACTIVA,
        fechaInicio: { lte: ahora },
        OR: [{ fechaFin: null }, { fechaFin: { gte: ahora } }],
      },
      include: {
        productos: { include: { producto: true } },
        gruposCombo: { include: { opciones: { include: { producto: true } } } },
      },
    });

    const ofertasFiltradas = ofertasActivas.filter((oferta) => {
      const dias = oferta.diasAplicables
        .split(',')
        .map((d) => parseInt(d.trim()));
      if (!dias.includes(diaSemana)) return false;

      if (oferta.horaInicio && oferta.horaFin) {
        if (horaActual < oferta.horaInicio || horaActual > oferta.horaFin) {
          return false;
        }
      }

      return true;
    });

    const productoIds = lineas.map((l) => l.productoId);
    const productos = await this.prisma.producto.findMany({
      where: { id: { in: productoIds } },
    });
    const productosMap = new Map(productos.map((p) => [p.id, p]));

    let subtotal = 0;
    for (const linea of lineas) {
      const prod = productosMap.get(linea.productoId);
      const precioBase = linea.precioUnitario || Number(prod?.precio || 0);
      subtotal += precioBase * linea.cantidad;
    }

    const resultado = this.aplicarMejorOferta(
      lineas,
      subtotal,
      ofertasFiltradas,
      productosMap,
    );

    return resultado;
  }

  private aplicarMejorOferta(
    lineas: LineaCalculo[],
    subtotal: number,
    ofertas: any[],
    productosMap: Map<string, any>,
  ): ResultadoCalculo {
    let mejorDescuento = 0;
    let mejorOferta: OfertaAplicada | null = null;

    for (const oferta of ofertas) {
      if (
        oferta.maxUsosTotales !== null &&
        oferta.usosActuales >= oferta.maxUsosTotales
      ) {
        continue;
      }

      const resultado = this.evaluarOferta(
        oferta,
        lineas,
        subtotal,
        productosMap,
      );
      if (resultado && resultado.descuento > mejorDescuento) {
        mejorDescuento = resultado.descuento;
        mejorOferta = resultado;
      }
    }

    return {
      subtotal,
      descuento: mejorDescuento,
      total: subtotal - mejorDescuento,
      ofertasAplicadas: mejorOferta ? [mejorOferta] : [],
    };
  }

  private evaluarOferta(
    oferta: any,
    lineas: LineaCalculo[],
    subtotal: number,
    productosMap: Map<string, any>,
  ): OfertaAplicada | null {
    switch (oferta.tipo) {
      case 'DOS_POR_UNO':
        return this.evaluar2x1(oferta, lineas, productosMap);
      case 'COMBO':
        return this.evaluarCombo(oferta, lineas, productosMap);
      case 'DESCUENTO_PORCENTAJE':
        return this.evaluarDescuentoPorcentaje(oferta, lineas, subtotal);
      case 'DESCUENTO_MONTO_FIJO':
        return this.evaluarDescuentoMontoFijo(oferta, lineas, subtotal);
      default:
        return null;
    }
  }

  private evaluar2x1(
    oferta: any,
    lineas: LineaCalculo[],
    productosMap: Map<string, any>,
  ): OfertaAplicada | null {
    const productosOferta = new Set(
      oferta.productos.map((p: any) => p.productoId),
    );
    if (productosOferta.size === 0) return null;

    const lineasAplican = lineas
      .map((l, idx) => ({ ...l, idx }))
      .filter((l) => productosOferta.has(l.productoId));

    if (lineasAplican.length < 2) return null;

    lineasAplican.sort((a, b) => {
      const precioA = Number(productosMap.get(a.productoId)?.precio || 0);
      const precioB = Number(productosMap.get(b.productoId)?.precio || 0);
      return precioB - precioA;
    });

    let descuentoTotal = 0;
    const lineasDescuento: { detalleIdx: number; descuentoLinea: number }[] =
      [];

    let paresEncontrados = 0;
    for (let i = 0; i < lineasAplican.length - 1; i += 2) {
      const primero = lineasAplican[i];
      const segundo = lineasAplican[i + 1];

      const precioPrimero = Number(
        productosMap.get(primero.productoId)?.precio || 0,
      );
      const precioSegundo = Number(
        productosMap.get(segundo.productoId)?.precio || 0,
      );

      const precioMasBajo = Math.min(precioPrimero, precioSegundo);
      descuentoTotal += precioMasBajo;

      lineasDescuento.push({
        detalleIdx: precioPrimero < precioSegundo ? primero.idx : segundo.idx,
        descuentoLinea: precioMasBajo,
      });

      paresEncontrados++;
    }

    if (paresEncontrados === 0) return null;

    return {
      ofertaId: oferta.id,
      nombre: oferta.nombre,
      tipo: 'DOS_POR_UNO',
      descuento: descuentoTotal,
      lineasAfectadas: lineasDescuento,
    };
  }

  private evaluarCombo(
    oferta: any,
    lineas: LineaCalculo[],
    productosMap: Map<string, any>,
  ): OfertaAplicada | null {
    if (!oferta.gruposCombo || oferta.gruposCombo.length === 0) return null;

    const lineasMap = new Map<string, number>();
    for (const linea of lineas) {
      const current = lineasMap.get(linea.productoId) || 0;
      lineasMap.set(linea.productoId, current + linea.cantidad);
    }

    for (const grupo of oferta.gruposCombo) {
      if (!grupo.obligatorio) continue;

      const opcionesIds = new Set(grupo.opciones.map((o: any) => o.productoId));
      let cantidadEncontrada = 0;

      for (const [productoId, cantidad] of lineasMap) {
        if (opcionesIds.has(productoId)) {
          cantidadEncontrada += cantidad;
        }
      }

      if (cantidadEncontrada < grupo.cantidad) return null;
    }

    let precioIndividual = 0;
    let precioCombo = 0;

    for (const grupo of oferta.gruposCombo) {
      for (const opcion of grupo.opciones) {
        const cantidad = lineasMap.get(opcion.productoId) || 0;
        if (cantidad > 0) {
          const precioProducto = Number(
            productosMap.get(opcion.productoId)?.precio || 0,
          );
          precioIndividual +=
            precioProducto * Math.min(cantidad, grupo.cantidad);
        }
      }
    }

    if (oferta.montoDescuento !== null && oferta.montoDescuento !== undefined) {
      precioCombo = Number(oferta.montoDescuento);
    } else {
      for (const producto of oferta.productos) {
        const cantidad = lineasMap.get(producto.productoId) || 0;
        if (cantidad > 0) {
          const precio =
            producto.precioEspecial ||
            Number(productosMap.get(producto.productoId)?.precio || 0);
          precioCombo += precio * cantidad;
        }
      }
    }

    const descuento = precioIndividual - precioCombo;
    if (descuento <= 0) return null;

    return {
      ofertaId: oferta.id,
      nombre: oferta.nombre,
      tipo: 'COMBO',
      descuento,
      lineasAfectadas: [],
    };
  }

  private evaluarDescuentoPorcentaje(
    oferta: any,
    lineas: LineaCalculo[],
    subtotal: number,
  ): OfertaAplicada | null {
    const productosOferta =
      oferta.productos.length > 0
        ? new Set(oferta.productos.map((p: any) => p.productoId))
        : null;

    let montoAplicable = 0;
    const lineasDescuento: { detalleIdx: number; descuentoLinea: number }[] =
      [];

    lineas.forEach((linea, idx) => {
      if (!productosOferta || productosOferta.has(linea.productoId)) {
        montoAplicable += linea.precioUnitario * linea.cantidad;
      }
    });

    if (montoAplicable === 0) return null;

    const porcentaje = Number(oferta.porcentajeDescuento) / 100;
    const descuento = montoAplicable * porcentaje;

    return {
      ofertaId: oferta.id,
      nombre: oferta.nombre,
      tipo: 'DESCUENTO_PORCENTAJE',
      descuento,
      lineasAfectadas: lineasDescuento,
    };
  }

  private evaluarDescuentoMontoFijo(
    oferta: any,
    lineas: LineaCalculo[],
    subtotal: number,
  ): OfertaAplicada | null {
    const productosOferta =
      oferta.productos.length > 0
        ? new Set(oferta.productos.map((p: any) => p.productoId))
        : null;

    let aplica = false;
    if (!productosOferta) {
      aplica = true;
    } else {
      for (const linea of lineas) {
        if (productosOferta.has(linea.productoId)) {
          aplica = true;
          break;
        }
      }
    }

    if (!aplica) return null;

    return {
      ofertaId: oferta.id,
      nombre: oferta.nombre,
      tipo: 'DESCUENTO_MONTO_FIJO',
      descuento: Number(oferta.montoDescuento),
      lineasAfectadas: [],
    };
  }
}
