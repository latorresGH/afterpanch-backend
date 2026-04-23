import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeocodingProvider } from './geocoding-provider.interface';

@Injectable()
export class NominatimGeocodingProvider implements GeocodingProvider {
  private readonly userAgent: string;
  private readonly logger = new Logger(NominatimGeocodingProvider.name);
  private readonly TIMEOUT_MS = 10000;
  private lastRequestTime = 0;
  private readonly MIN_INTERVAL_MS = 1000;

  constructor(private configService: ConfigService) {
    this.userAgent = this.configService.get<string>('NOMINATIM_USER_AGENT', 'Afterpanch/1.0');
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.MIN_INTERVAL_MS) {
      const wait = this.MIN_INTERVAL_MS - elapsed;
      console.log(`[GEOCODING] Rate limit interno activado, esperando ${wait}ms`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastRequestTime = Date.now();
  }

  async geocode(
    rawAddress: string,
    proximity?: { lat: number; lng: number },
  ): Promise<{
    lat: number;
    lng: number;
    formattedAddress: string;
    importance: number;
    precision?: 'exact' | 'street';
  } | null> {
    await this.enforceRateLimit();

    const encoded = encodeURIComponent(rawAddress);
    let url = `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&countrycodes=ar&addressdetails=1&limit=1&accept-language=es`;

    if (proximity) {
      const offset = 0.45;
      const minLng = proximity.lng - offset;
      const minLat = proximity.lat - offset;
      const maxLng = proximity.lng + offset;
      const maxLat = proximity.lat + offset;
      url += `&viewbox=${minLng},${maxLat},${maxLng},${minLat}&bounded=0`;
    }

    const doFetch = async (): Promise<Response> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.TIMEOUT_MS);
      try {
        return await fetch(url, {
          headers: { 'User-Agent': this.userAgent },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    };

    let response: Response;
    try {
      response = await doFetch();
    } catch (error: any) {
      if (error.name === 'AbortError') {
        this.logger.warn(`Timeout al geocodificar "${rawAddress}"`);
      } else {
        this.logger.error(`Error al geocodificar "${rawAddress}": ${error.message}`);
      }
      return null;
    }

    if (response.status === 429) {
      console.log(`[GEOCODING] Nominatim devolvió 429, reintentando en 2s`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await this.enforceRateLimit();
      try {
        response = await doFetch();
      } catch (error: any) {
        this.logger.error(`Reintento fallido para "${rawAddress}": ${error.message}`);
        return null;
      }
    }

    if (response.status >= 500) {
      this.logger.warn(`Nominatim respondió con ${response.status} para "${rawAddress}"`);
      return null;
    }

    if (!response.ok) {
      this.logger.warn(`Nominatim respondió con status ${response.status} para "${rawAddress}"`);
      return null;
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    const result = data[0];
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    const formattedAddress = result.display_name;
    const importance = parseFloat(result.importance) ?? 0;
    const hasHouseNumber = !!result.address?.house_number;

    const precision = hasHouseNumber ? 'exact' : 'street';

    console.log(`[GEOCODING] Nominatim respondió con importance=${importance.toFixed(3)}, house_number=${hasHouseNumber ? 'presente' : 'ausente'}`);

    return {
      lat,
      lng,
      formattedAddress,
      importance,
      precision,
    };
  }
}
