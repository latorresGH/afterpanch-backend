import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { GeocodingService } from './geocoding.service';
import { GeocodingProvider } from './providers/geocoding-provider.interface';
import { PrismaService } from '../prisma/prisma.service';

describe('GeocodingService', () => {
  let service: GeocodingService;
  let prisma: any;
  let provider: any;

  const mockPrisma = () => ({
    geocodingCache: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    shippingConfig: {
      findFirst: jest.fn().mockResolvedValue({
        localLat: -34.6,
        localLng: -58.38,
      }),
    },
  });

  const mockProvider = () => ({
    geocode: jest.fn(),
  });

  beforeEach(async () => {
    prisma = mockPrisma();
    provider = mockProvider();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeocodingService,
        { provide: PrismaService, useValue: prisma },
        { provide: 'GEOCODING_PROVIDER', useValue: provider },
      ],
    }).compile();

    service = module.get<GeocodingService>(GeocodingService);
  });

  describe('geocode - cache hit', () => {
    it('devuelve resultado desde caché si existe', async () => {
      prisma.geocodingCache.findUnique.mockResolvedValue({
        id: '1',
        lat: -34.6,
        lng: -58.38,
        formattedAddress: 'Av. Corrientes 1234, CABA',
        importance: 0.95,
        precision: 'exact',
        hitCount: 5,
      });
      prisma.geocodingCache.update.mockResolvedValue({});

      const result = await service.geocode('Av. Corrientes 1234');

      expect(result.fromCache).toBe(true);
      expect(result.lat).toBe(-34.6);
      expect(result.lng).toBe(-58.38);
      expect(result.precision).toBe('exact');
      expect(prisma.geocodingCache.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            hitCount: { increment: 1 },
          }),
        }),
      );
    });

    it('devuelve precision=manual desde caché (no dispara modal)', async () => {
      prisma.geocodingCache.findUnique.mockResolvedValue({
        id: '2',
        lat: -34.61,
        lng: -58.39,
        formattedAddress: 'Los Talas 450',
        importance: 1,
        precision: 'manual',
        hitCount: 2,
      });
      prisma.geocodingCache.update.mockResolvedValue({});

      const result = await service.geocode('Los Talas 450');

      expect(result.fromCache).toBe(true);
      expect(result.precision).toBe('manual');
    });
  });

  describe('geocode - cache miss + primer intento exitoso', () => {
    it('exact con importance muy bajo (0.05) → acepta igual, sin lowConfidence', async () => {
      prisma.geocodingCache.findUnique.mockResolvedValue(null);
      provider.geocode.mockResolvedValue({
        lat: -34.6,
        lng: -58.38,
        formattedAddress: 'Av. Corrientes 1234, CABA',
        importance: 0.053,
        precision: 'exact',
      });
      prisma.geocodingCache.create.mockResolvedValue({});

      const result = await service.geocode('Av. Corrientes 1234');

      expect(result.fromCache).toBe(false);
      expect(result.lat).toBe(-34.6);
      expect(result.precision).toBe('exact');
      expect(result.lowConfidence).toBe(false);
      expect(prisma.geocodingCache.create).toHaveBeenCalled();
    });

    it('street con importance bajo (0.05) → acepta con lowConfidence', async () => {
      prisma.geocodingCache.findUnique.mockResolvedValue(null);
      provider.geocode.mockResolvedValue({
        lat: -34.6,
        lng: -58.38,
        formattedAddress: 'Los Talas, Paraná',
        importance: 0.053,
        precision: 'street',
      });
      prisma.geocodingCache.create.mockResolvedValue({});

      const result = await service.geocode('Los Talas 450, Paraná');

      expect(result.fromCache).toBe(false);
      expect(result.precision).toBe('street');
      expect(result.lowConfidence).toBe(true);
    });

    it('street con importance=0 → rechaza e intenta sin altura', async () => {
      prisma.geocodingCache.findUnique.mockResolvedValue(null);
      provider.geocode.mockResolvedValueOnce({
        lat: -34.6,
        lng: -58.38,
        formattedAddress: 'Algo 123',
        importance: 0,
        precision: 'street',
      });
      provider.geocode.mockResolvedValueOnce({
        lat: -34.6,
        lng: -58.38,
        formattedAddress: 'Algo',
        importance: 0.05,
        precision: 'street',
      });
      prisma.geocodingCache.create.mockResolvedValue({});

      const result = await service.geocode('Algo 123');

      expect(result.precision).toBe('street');
      expect(result.lowConfidence).toBe(true);
      expect(provider.geocode).toHaveBeenCalledTimes(2);
    });
  });

  describe('geocode - proximity / viewbox', () => {
    it('pasa proximity al provider cuando ShippingConfig existe', async () => {
      prisma.geocodingCache.findUnique.mockResolvedValue(null);
      provider.geocode.mockResolvedValue({
        lat: -34.6,
        lng: -58.38,
        formattedAddress: 'Nelson Mandela, Recreo',
        importance: 0.05,
        precision: 'street',
      });
      prisma.geocodingCache.create.mockResolvedValue({});

      await service.geocode('Nelson Mandela, Recreo');

      expect(provider.geocode).toHaveBeenCalledWith(
        'Nelson Mandela, Recreo',
        { lat: -34.6, lng: -58.38 },
      );
    });

    it('no pasa proximity si ShippingConfig no existe', async () => {
      prisma.shippingConfig.findFirst.mockResolvedValue(null);
      prisma.geocodingCache.findUnique.mockResolvedValue(null);
      provider.geocode.mockResolvedValue({
        lat: -34.6,
        lng: -58.38,
        formattedAddress: 'Algo 123',
        importance: 0.05,
        precision: 'exact',
      });
      prisma.geocodingCache.create.mockResolvedValue({});

      await service.geocode('Algo 123');

      expect(provider.geocode).toHaveBeenCalledWith(
        'Algo 123',
        undefined,
      );
    });
  });

  describe('geocode - segundo intento sin altura', () => {
    it('primer intento nulo, segundo exitoso → precision=street', async () => {
      prisma.geocodingCache.findUnique.mockResolvedValue(null);

      // Primer intento: null
      provider.geocode.mockResolvedValueOnce(null);

      // Segundo intento (sin altura): street-level
      provider.geocode.mockResolvedValueOnce({
        lat: -34.605,
        lng: -58.385,
        formattedAddress: 'Los Talas, Paraná',
        importance: 0.05,
        precision: 'street',
      });

      prisma.geocodingCache.create.mockResolvedValue({});

      const result = await service.geocode('Los Talas 450, Paraná');

      expect(result.precision).toBe('street');
      expect(result.lowConfidence).toBe(true);
      expect(provider.geocode).toHaveBeenCalledTimes(2);
      expect(prisma.geocodingCache.create).toHaveBeenCalled();
    });

    it('ambos intentos fallan → NotFoundException', async () => {
      prisma.geocodingCache.findUnique.mockResolvedValue(null);
      provider.geocode.mockResolvedValue(null);

      await expect(service.geocode('direccion inexistente')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('ambos intentos con relevance=0 → NotFoundException', async () => {
      prisma.geocodingCache.findUnique.mockResolvedValue(null);
      provider.geocode.mockResolvedValueOnce({
        lat: -34.6,
        lng: -58.38,
        formattedAddress: 'Algo 123',
        importance: 0,
        precision: 'street',
      });
      provider.geocode.mockResolvedValueOnce({
        lat: -34.6,
        lng: -58.38,
        formattedAddress: 'Algo',
        importance: 0,
        precision: 'street',
      });

      await expect(service.geocode('Algo 123')).rejects.toThrow(NotFoundException);
    });
  });

  describe('geocodeManual', () => {
    it('guarda dirección manual nueva', async () => {
      prisma.geocodingCache.findUnique.mockResolvedValue(null);
      prisma.geocodingCache.create.mockResolvedValue({});

      const result = await service.geocodeManual('Los Talas 450', -34.61, -58.39);

      expect(result.precision).toBe('manual');
      expect(result.lat).toBe(-34.61);
      expect(result.lng).toBe(-58.39);
      expect(result.fromCache).toBe(false);
      expect(result.importance).toBe(1);
      expect(prisma.geocodingCache.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            precision: 'manual',
            importance: 1,
          }),
        }),
      );
    });

    it('actualiza dirección existente (upsert)', async () => {
      prisma.geocodingCache.findUnique.mockResolvedValue({
        id: '1',
        normalizedKey: 'av los talas 450',
        lat: -34.6,
        lng: -58.38,
        precision: 'street',
      });
      prisma.geocodingCache.update.mockResolvedValue({});

      const result = await service.geocodeManual('Los Talas 450', -34.61, -58.39);

      expect(result.precision).toBe('manual');
      expect(prisma.geocodingCache.update).toHaveBeenCalled();
      expect(prisma.geocodingCache.create).not.toHaveBeenCalled();
    });
  });

  describe('geocode - error de red/timeout', () => {
    it('lanza NotFoundException si el provider lanza error', async () => {
      prisma.geocodingCache.findUnique.mockResolvedValue(null);
      provider.geocode.mockRejectedValue(new Error('Network error'));

      await expect(service.geocode('algo')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getCacheEntries', () => {
    it('devuelve entradas paginadas', async () => {
      const entries = [
        { id: '1', normalizedKey: 'av corrientes 1234', formattedAddress: 'Av. Corrientes 1234', lat: -34.6, lng: -58.38, importance: 0.9, precision: 'exact', hitCount: 5, createdAt: new Date(), lastUsedAt: new Date() },
      ];
      prisma.geocodingCache.findMany.mockResolvedValue(entries);
      prisma.geocodingCache.count.mockResolvedValue(1);

      const result = await service.getCacheEntries(1, 20);

      expect(result.entries).toEqual(entries);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });
  });

  describe('deleteCacheEntry', () => {
    it('elimina una entrada existente', async () => {
      prisma.geocodingCache.findUnique.mockResolvedValue({ id: '1', normalizedKey: 'test' });
      prisma.geocodingCache.delete.mockResolvedValue({ id: '1' });

      const result = await service.deleteCacheEntry('1');

      expect(result.deleted).toBe(true);
      expect(prisma.geocodingCache.delete).toHaveBeenCalledWith({ where: { id: '1' } });
    });

    it('lanza NotFoundException si la entrada no existe', async () => {
      prisma.geocodingCache.findUnique.mockResolvedValue(null);

      await expect(service.deleteCacheEntry('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
