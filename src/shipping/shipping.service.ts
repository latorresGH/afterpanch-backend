import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as turf from '@turf/turf';

export type ShippingReason =
  | 'inside'
  | 'near_border'
  | 'inside_radius'
  | 'out_of_range'
  | 'no_zones_configured';

export interface CalculateShippingResponse {
  available: boolean;
  price: number | null;
  zoneName: string | null;
  reason: ShippingReason;
  distanceToBorderMeters?: number;
  distanceToLocalKm?: number;
  tierLabel?: string;
}

@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);

  constructor(private prisma: PrismaService) {}

  async getConfig() {
    return this.prisma.shippingConfig.findFirst();
  }

  async updateConfig(data: {
    mode?: 'RADIUS' | 'POLYGON' | 'RADIUS_TIERS';
    localLat?: number;
    localLng?: number;
    radiusKm?: number;
    radiusPrice?: number;
    maxDeliveryRadiusKm?: number;
    borderToleranceMeters?: number;
  }) {
    const existing = await this.prisma.shippingConfig.findFirst();
    if (existing) {
      return this.prisma.shippingConfig.update({
        where: { id: existing.id },
        data,
      });
    }
    return this.prisma.shippingConfig.create({
      data: {
        mode: data.mode ?? 'RADIUS',
        localLat: data.localLat ?? 0,
        localLng: data.localLng ?? 0,
        radiusKm: data.radiusKm ?? 5,
        radiusPrice: data.radiusPrice ?? 0,
        maxDeliveryRadiusKm: data.maxDeliveryRadiusKm ?? 10,
        borderToleranceMeters: data.borderToleranceMeters ?? 500,
      },
    });
  }

  async getZones() {
    return this.prisma.shippingZone.findMany({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createZone(name: string, price: number, polygon: any) {
    return this.prisma.shippingZone.create({
      data: { name, price, polygon },
    });
  }

  async updateZone(
    id: string,
    data: { name?: string; price?: number; polygon?: any },
  ) {
    return this.prisma.shippingZone.update({
      where: { id },
      data,
    });
  }

  async deleteZone(id: string) {
    return this.prisma.shippingZone.update({
      where: { id },
      data: { active: false },
    });
  }

  // --- RADIUS TIERS ---

  async getTiers() {
    return this.prisma.shippingRadiusTier.findMany({
      where: { active: true },
      orderBy: [{ order: 'asc' }, { fromKm: 'asc' }],
    });
  }

  async getTierById(id: string) {
    return this.prisma.shippingRadiusTier.findUnique({
      where: { id },
    });
  }

  async createTier(data: { fromKm: number; toKm: number; price: number; order?: number }) {
    return this.prisma.shippingRadiusTier.create({
      data: {
        fromKm: data.fromKm,
        toKm: data.toKm,
        price: data.price,
        order: data.order ?? 0,
      },
    });
  }

  async updateTier(
    id: string,
    data: { fromKm?: number; toKm?: number; price?: number; order?: number },
  ) {
    return this.prisma.shippingRadiusTier.update({
      where: { id },
      data,
    });
  }

  async deleteTier(id: string) {
    return this.prisma.shippingRadiusTier.update({
      where: { id },
      data: { active: false },
    });
  }

  /**
   * Valida solapamiento entre un tier nuevo/editado y los existentes.
   * Dos rangos [a,b) y [c,d) se superponen si a < d && c < b.
   */
  async checkTierOverlap(
    fromKm: number,
    toKm: number,
    excludeTierId?: string,
  ): Promise<string[]> {
    const tiers = await this.prisma.shippingRadiusTier.findMany({
      where: {
        active: true,
        ...(excludeTierId ? { id: { not: excludeTierId } } : {}),
      },
    });

    const warnings: string[] = [];

    for (const tier of tiers) {
      if (fromKm < tier.toKm && tier.fromKm < toKm) {
        warnings.push(`${tier.fromKm}-${tier.toKm} km`);
      }
    }

    return warnings;
  }

  /**
   * Detecta huecos entre rangos de tiers.
   * Devuelve array de descripciones de huecos encontrados.
   */
  async checkTierGaps(
    fromKm: number,
    toKm: number,
    excludeTierId?: string,
  ): Promise<string[]> {
    const tiers = await this.prisma.shippingRadiusTier.findMany({
      where: {
        active: true,
        ...(excludeTierId ? { id: { not: excludeTierId } } : {}),
      },
      orderBy: { fromKm: 'asc' },
    });

    const allRanges = [
      ...tiers.map((t) => ({ from: t.fromKm, to: t.toKm })),
      { from: fromKm, to: toKm },
    ].sort((a, b) => a.from - b.from);

    const gaps: string[] = [];

    for (let i = 0; i < allRanges.length - 1; i++) {
      const current = allRanges[i];
      const next = allRanges[i + 1];
      if (current.to < next.from) {
        gaps.push(`${current.to}-${next.from} km`);
      }
    }

    return gaps;
  }

  /**
   * Calcula el costo de envío para un punto (lat, lng) según la config activa.
   */
  async calculate(lat: number, lng: number): Promise<CalculateShippingResponse> {
    console.log(`[SHIPPING] Calculate iniciado: lat=${lat}, lng=${lng}`);

    const config = await this.getConfig();
    console.log(`[SHIPPING] Config cargada: modo=${config?.mode ?? 'null'}, localLat=${config?.localLat}, localLng=${config?.localLng}`);

    if (!config) {
      console.log(`[SHIPPING] Resultado final: no_zones_configured - null`);
      return {
        available: false,
        price: null,
        zoneName: null,
        reason: 'no_zones_configured',
      };
    }

    const localPoint = turf.point([config.localLng, config.localLat]);
    const clientPoint = turf.point([lng, lat]);
    const distanceToLocalKm = turf.distance(localPoint, clientPoint, {
      units: 'kilometers',
    });
    const distRounded = Math.round(distanceToLocalKm * 100) / 100;
    console.log(`[SHIPPING] Distancia al local: ${distRounded} km`);

    if (config.mode === 'RADIUS') {
      if (distanceToLocalKm <= config.radiusKm) {
        console.log(`[SHIPPING] Resultado final: inside_radius - ${config.radiusPrice}`);
        return {
          available: true,
          price: config.radiusPrice,
          zoneName: null,
          reason: 'inside_radius',
          distanceToLocalKm: distRounded,
        };
      }

      console.log(`[SHIPPING] Resultado final: out_of_range - null`);
      return {
        available: false,
        price: null,
        zoneName: null,
        reason: 'out_of_range',
        distanceToLocalKm: distRounded,
      };
    }

    if (config.mode === 'RADIUS_TIERS') {
      return this.calculateRadiusTiers(distanceToLocalKm, config);
    }

    // Modo POLYGON
    // 1. Verificar radio máximo de entrega (tope duro)
    if (distanceToLocalKm > config.maxDeliveryRadiusKm) {
      console.log(`[SHIPPING] Resultado final: out_of_range (supera maxDeliveryRadiusKm=${config.maxDeliveryRadiusKm}) - null`);
      return {
        available: false,
        price: null,
        zoneName: null,
        reason: 'out_of_range',
        distanceToLocalKm: distRounded,
      };
    }

    // 2. Buscar zonas activas
    const zones = await this.getZones();
    console.log(`[SHIPPING] Zonas cargadas: ${zones.length} activas`);

    if (zones.length === 0) {
      console.log(`[SHIPPING] Resultado final: no_zones_configured - null`);
      return {
        available: false,
        price: null,
        zoneName: null,
        reason: 'no_zones_configured',
        distanceToLocalKm: distRounded,
      };
    }

    // 3. Verificar si el punto cae dentro de algún polígono
    for (const zone of zones) {
      const polygonData = zone.polygon as any;
      const poly = turf.polygon(polygonData.coordinates);

      if (turf.booleanPointInPolygon(clientPoint, poly)) {
        console.log(`[SHIPPING] Punto dentro de zona: ${zone.name}`);
        console.log(`[SHIPPING] Resultado final: inside - ${zone.price}`);
        return {
          available: true,
          price: zone.price,
          zoneName: zone.name,
          reason: 'inside',
          distanceToLocalKm: distRounded,
        };
      }
    }

    // 4. No cayó en ningún polígono → calcular distancia al borde de cada zona
    console.log(`[SHIPPING] Punto NO cae en ninguna zona, buscando más cercana`);
    let closestZone: { name: string; price: number; distanceMeters: number } | null = null;

    for (const zone of zones) {
      const polygonData = zone.polygon as any;
      const poly = turf.polygon(polygonData.coordinates);

      const line = turf.polygonToLine(poly);
      const distMeters = turf.pointToLineDistance(clientPoint, line as any, {
        units: 'meters',
      });

      if (!closestZone || distMeters < closestZone.distanceMeters) {
        closestZone = {
          name: zone.name,
          price: zone.price,
          distanceMeters: distMeters,
        };
      }
    }

    if (!closestZone) {
      console.log(`[SHIPPING] Resultado final: out_of_range - null`);
      return {
        available: false,
        price: null,
        zoneName: null,
        reason: 'out_of_range',
        distanceToLocalKm: distRounded,
      };
    }

    console.log(`[SHIPPING] Zona más cercana: ${closestZone.name} a ${Math.round(closestZone.distanceMeters)} metros del borde`);

    // 5. Si la distancia al borde está dentro de la tolerancia → near_border
    if (closestZone.distanceMeters <= config.borderToleranceMeters) {
      console.log(`[SHIPPING] Resultado final: near_border - ${closestZone.price}`);
      return {
        available: true,
        price: closestZone.price,
        zoneName: closestZone.name,
        reason: 'near_border',
        distanceToBorderMeters: Math.round(closestZone.distanceMeters),
        distanceToLocalKm: distRounded,
      };
    }

    // 6. Fuera de zona (más allá de la tolerancia)
    console.log(`[SHIPPING] Resultado final: out_of_range - null`);
    return {
      available: false,
      price: null,
      zoneName: null,
      reason: 'out_of_range',
      distanceToBorderMeters: Math.round(closestZone.distanceMeters),
      distanceToLocalKm: distRounded,
    };
  }

  private async calculateRadiusTiers(
    distanceToLocalKm: number,
    config: any,
  ): Promise<CalculateShippingResponse> {
    const distRounded = Math.round(distanceToLocalKm * 100) / 100;

    const tiers = await this.getTiers();
    console.log(`[SHIPPING] Tiers cargados: ${tiers.length} activos`);

    if (tiers.length === 0) {
      console.log(`[SHIPPING] Resultado final: no_zones_configured - null`);
      return {
        available: false,
        price: null,
        zoneName: null,
        reason: 'no_zones_configured',
        distanceToLocalKm: distRounded,
      };
    }

    // Verificar radio máximo de entrega si está configurado
    if (config.maxDeliveryRadiusKm && distanceToLocalKm > config.maxDeliveryRadiusKm) {
      console.log(`[SHIPPING] Resultado final: out_of_range (supera maxDeliveryRadiusKm=${config.maxDeliveryRadiusKm}) - null`);
      return {
        available: false,
        price: null,
        zoneName: null,
        reason: 'out_of_range',
        distanceToLocalKm: distRounded,
      };
    }

    for (const tier of tiers) {
      if (distanceToLocalKm >= tier.fromKm && distanceToLocalKm < tier.toKm) {
        const tierLabel = `${tier.fromKm}-${tier.toKm} km`;
        console.log(`[SHIPPING] Resultado final: inside_radius (tier: ${tierLabel}) - ${tier.price}`);
        return {
          available: true,
          price: tier.price,
          zoneName: tierLabel,
          reason: 'inside_radius',
          distanceToLocalKm: distRounded,
          tierLabel,
        };
      }
    }

    console.log(`[SHIPPING] Resultado final: out_of_range - null`);
    return {
      available: false,
      price: null,
      zoneName: null,
      reason: 'out_of_range',
      distanceToLocalKm: distRounded,
    };
  }

  /**
   * Valida superposición entre una zona nueva/editada y las existentes.
   */
  async checkOverlap(
    polygon: any,
    excludeZoneId?: string,
  ): Promise<string[]> {
    const zones = await this.prisma.shippingZone.findMany({
      where: {
        active: true,
        ...(excludeZoneId ? { id: { not: excludeZoneId } } : {}),
      },
    });

    const warnings: string[] = [];
    const newPoly = turf.polygon(polygon.coordinates);

    for (const zone of zones) {
      try {
        const existingPoly = turf.polygon(
          (zone.polygon as any).coordinates,
        );
        if (turf.booleanOverlap(newPoly, existingPoly)) {
          warnings.push(zone.name);
        }
      } catch {
        this.logger.warn(
          `No se pudo verificar overlap con zona ${zone.name} — polígono inválido`,
        );
      }
    }

    return warnings;
  }

  /**
   * Valida que un polígono sea cerrado y válido.
   */
  validatePolygon(polygon: any): { valid: boolean; error?: string } {
    if (!polygon || !polygon.coordinates || !Array.isArray(polygon.coordinates)) {
      return { valid: false, error: 'Formato de polígono inválido' };
    }

    const rings = polygon.coordinates;
    if (!rings[0] || rings[0].length < 4) {
      return {
        valid: false,
        error: 'El polígono debe tener al menos 4 puntos (3 vértices + cierre)',
      };
    }

    const ring = rings[0];
    const first = ring[0];
    const last = ring[ring.length - 1];

    if (
      first[0] !== last[0] ||
      first[1] !== last[1]
    ) {
      return {
        valid: false,
        error: 'El polígono debe estar cerrado (primer y último punto iguales)',
      };
    }

    return { valid: true };
  }
}
