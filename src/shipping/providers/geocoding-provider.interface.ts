export interface GeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
  fromCache: boolean;
  lowConfidence?: boolean;
  importance?: number;
  precision: 'exact' | 'street' | 'manual';
}

/**
 * Interfaz abstracta para proveedores de geocoding.
 * Permite swappear Mapbox por otro proveedor (Nominatim, LocationIQ, etc.)
 * sin tocar el resto del sistema.
 */
export interface GeocodingProvider {
  /**
   * Geocodifica una dirección cruda y devuelve coordenadas + dirección formateada.
   * @param rawAddress Dirección ingresada por el usuario
   * @param proximity Coordenadas del local para sesgar resultados cercanos
   * @returns Resultado del geocoding o null si no hay resultados
   */
  geocode(rawAddress: string, proximity?: { lat: number; lng: number }): Promise<{
    lat: number;
    lng: number;
    formattedAddress: string;
    importance: number;
    precision?: 'exact' | 'street';
  } | null>;
}
