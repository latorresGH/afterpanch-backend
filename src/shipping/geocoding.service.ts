import { Injectable, NotFoundException, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { GeocodingProvider, GeocodeResult } from './providers/geocoding-provider.interface';
import { normalizeAddress } from './helpers/normalize-address';

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);

  constructor(
    private prisma: PrismaService,
    @Inject('GEOCODING_PROVIDER')
    private geocodingProvider: GeocodingProvider,
  ) {}

  async geocode(address: string): Promise<GeocodeResult> {
    console.log(`[GEOCODING] Consulta iniciada: ${address}`);

    const normalizedKey = normalizeAddress(address);
    console.log(`[GEOCODING] Dirección normalizada: ${normalizedKey}`);

    const cached = await this.prisma.geocodingCache.findUnique({
      where: { normalizedKey },
    });

    if (cached) {
      console.log(`[GEOCODING] Cache HIT con precision=${cached.precision}, hitCount=${cached.hitCount}`);
      await this.prisma.geocodingCache.update({
        where: { id: cached.id },
        data: {
          hitCount: { increment: 1 },
          lastUsedAt: new Date(),
        },
      });

      return {
        lat: cached.lat,
        lng: cached.lng,
        formattedAddress: cached.formattedAddress,
        fromCache: true,
        importance: cached.importance,
        precision: cached.precision as 'exact' | 'street' | 'manual',
      };
    }

    const config = await this.prisma.shippingConfig.findFirst();
    let proximity: { lat: number; lng: number } | undefined;

    if (config && config.localLat != null && config.localLng != null) {
      proximity = { lat: config.localLat, lng: config.localLng };
      console.log(`[GEOCODING] Proximity usado: ${proximity.lat},${proximity.lng}`);
    } else {
      console.log(`[GEOCODING] Sin ShippingConfig, sin proximity`);
    }

    console.log(`[GEOCODING] Cache MISS, consultando Nominatim`);

    let result;
    try {
      result = await this.geocodingProvider.geocode(address, proximity);
    } catch (error: any) {
      console.error(`[SHIPPING-ERROR] Error de Nominatim: ${error.message}`);
      this.logger.error(`Error del provider al geocodificar: ${error.message}`);
      throw new NotFoundException('No se pudo ubicar esa dirección');
    }

    if (result) {
      console.log(`[GEOCODING] Nominatim respondió con precision=${result.precision ?? 'unknown'}, relevance=${result.importance}`);
    }

    if (result && result.precision === 'exact') {
      console.log(`[GEOCODING] Primer intento exitoso (exact, house_number presente)`);
      return this.saveAndReturn(result, normalizedKey, 'exact');
    }

    if (result && result.importance >= 0.001) {
      console.log(`[GEOCODING] Primer intento con precision=street, aceptando con lowConfidence`);
      return this.saveAndReturn(result, normalizedKey, 'street');
    }

    console.log(`[GEOCODING] Primer intento insuficiente, probando sin altura`);
    const addressSinAltura = address.replace(/\s+\d+\s*/, ' ').trim();
    let streetResult;
    try {
      streetResult = await this.geocodingProvider.geocode(addressSinAltura, proximity);
    } catch (error: any) {
      console.error(`[SHIPPING-ERROR] Error de Nominatim (sin altura): ${error.message}`);
    }

    if (streetResult && streetResult.importance >= 0.001) {
      console.log(`[GEOCODING] Segundo intento exitoso (street-level)`);
      return this.saveAndReturn(streetResult, normalizedKey, 'street');
    }

    if (!result && !streetResult) {
      console.log(`[GEOCODING] Nominatim no devolvió resultados para: ${address}`);
      throw new NotFoundException('No se pudo ubicar esa dirección');
    }

    console.log(`[GEOCODING] Ambos intentos fallaron`);
    throw new NotFoundException('No se pudo ubicar esa dirección');
  }

  private async saveAndReturn(
    result: { lat: number; lng: number; formattedAddress: string; importance: number; precision?: 'exact' | 'street' },
    normalizedKey: string,
    fallbackPrecision: 'exact' | 'street',
  ): Promise<GeocodeResult> {
    const precision = result.precision ?? fallbackPrecision;
    const { lat, lng, formattedAddress, importance } = result;

    try {
      await this.prisma.geocodingCache.create({
        data: {
          normalizedKey,
          formattedAddress,
          lat,
          lng,
          importance,
          precision,
        },
      });
    } catch {
      await this.prisma.geocodingCache.update({
        where: { normalizedKey },
        data: { formattedAddress, lat, lng, importance, precision },
      });
    }

    if (precision === 'street') {
      console.log(`[GEOCODING] Resultado cacheado (precision=street)`);
    } else {
      console.log(`[GEOCODING] Resultado cacheado (precision=exact)`);
    }

    return {
      lat,
      lng,
      formattedAddress,
      fromCache: false,
      lowConfidence: precision === 'street',
      importance,
      precision,
    };
  }

  async geocodeManual(address: string, lat: number, lng: number): Promise<GeocodeResult> {
    const normalizedKey = normalizeAddress(address);
    const formattedAddress = address;

    const existing = await this.prisma.geocodingCache.findUnique({
      where: { normalizedKey },
    });

    if (existing) {
      await this.prisma.geocodingCache.update({
        where: { id: existing.id },
        data: {
          formattedAddress,
          lat,
          lng,
          importance: 1,
          precision: 'manual',
          hitCount: { increment: 1 },
          lastUsedAt: new Date(),
        },
      });
      console.log(`[GEOCODING] Geocoding manual actualizado (ya existía): ${normalizedKey}`);
    } else {
      await this.prisma.geocodingCache.create({
        data: {
          normalizedKey,
          formattedAddress,
          lat,
          lng,
          importance: 1,
          precision: 'manual',
          hitCount: 1,
        },
      });
      console.log(`[GEOCODING] Geocoding manual guardado: ${normalizedKey} → ${lat},${lng}`);
    }

    return {
      lat,
      lng,
      formattedAddress,
      fromCache: false,
      importance: 1,
      precision: 'manual',
    };
  }

  async getCacheEntries(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    const [entries, total] = await Promise.all([
      this.prisma.geocodingCache.findMany({
        orderBy: { lastUsedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.geocodingCache.count(),
    ]);

    return {
      entries,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async deleteCacheEntry(id: string) {
    const entry = await this.prisma.geocodingCache.findUnique({ where: { id } });
    if (!entry) {
      throw new NotFoundException('Entrada de caché no encontrada');
    }
    await this.prisma.geocodingCache.delete({ where: { id } });
    console.log(`[GEOCODING] Entrada de caché eliminada: ${entry.normalizedKey}`);
    return { deleted: true, id };
  }
}
