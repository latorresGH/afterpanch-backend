import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NominatimGeocodingProvider } from './nominatim.provider';

describe('NominatimGeocodingProvider', () => {
  let provider: NominatimGeocodingProvider;
  let configService: ConfigService;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NominatimGeocodingProvider,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('Afterpanch/1.0 (test@example.com)') } },
      ],
    }).compile();

    provider = module.get<NominatimGeocodingProvider>(NominatimGeocodingProvider);
    configService = module.get<ConfigService>(ConfigService);
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('devuelve null si no hay resultados', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [] });

    const result = await provider.geocode('direccion inexistente');

    expect(result).toBeNull();
  });

  it('parsea resultado con house_number → precision=exact', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{
        lat: '-34.6',
        lon: '-58.38',
        display_name: 'Av. Corrientes 1234, CABA',
        importance: '0.95',
        address: { house_number: '1234', road: 'Avenida Corrientes' },
      }],
    });

    const result = await provider.geocode('Av. Corrientes 1234');

    expect(result).not.toBeNull();
    expect(result!.precision).toBe('exact');
    expect(result!.importance).toBe(0.95);
    expect(result!.formattedAddress).toBe('Av. Corrientes 1234, CABA');
  });

  it('parsea resultado sin house_number → precision=street', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{
        lat: '-34.6',
        lon: '-58.38',
        display_name: 'Los Talas, Paraná',
        importance: '0.5',
        address: { road: 'Los Talas' },
      }],
    });

    const result = await provider.geocode('Los Talas');

    expect(result).not.toBeNull();
    expect(result!.precision).toBe('street');
    expect(result!.importance).toBe(0.5);
  });

  it('incluye viewbox cuando hay proximity', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{
        lat: '-34.6',
        lon: '-58.38',
        display_name: 'Test',
        importance: '0.9',
        address: {},
      }],
    });

    await provider.geocode('Test', { lat: -34.6, lng: -58.38 });

    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('viewbox=');
    expect(url).toContain('bounded=0');
  });

  it('no incluye viewbox cuando no hay proximity', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    });

    await provider.geocode('Test');

    const url = fetchMock.mock.calls[0][0];
    expect(url).not.toContain('viewbox=');
  });

  it('reintenta una vez si Nominatim devuelve 429', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{
          lat: '-34.6',
          lon: '-58.38',
          display_name: 'Test',
          importance: '0.9',
          address: { house_number: '1' },
        }],
      });

    const result = await provider.geocode('Test');

    expect(result).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falla gracefully si Nominatim devuelve 5xx', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    const result = await provider.geocode('Test');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falla gracefully en timeout', async () => {
    fetchMock.mockRejectedValue(new Error('Timeout'));

    const result = await provider.geocode('Test');

    expect(result).toBeNull();
  });

  it('respeta rate limit de 1 segundo entre requests', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{
        lat: '-34.6',
        lon: '-58.38',
        display_name: 'Test',
        importance: '0.9',
        address: {},
      }],
    });

    const start = Date.now();
    await provider.geocode('Test 1');
    await provider.geocode('Test 2');
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
