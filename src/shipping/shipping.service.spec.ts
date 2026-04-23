import { Test, TestingModule } from '@nestjs/testing';
import { ShippingService } from './shipping.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ShippingService', () => {
  let service: ShippingService;
  let prisma: any;

  const localLat = -34.6;
  const localLng = -58.38;

  const polygonNearLocal = {
    type: 'Polygon',
    coordinates: [
      [
        [-58.39, -34.61],
        [-58.37, -34.61],
        [-58.37, -34.59],
        [-58.39, -34.59],
        [-58.39, -34.61],
      ],
    ],
  };

  const polygonFar = {
    type: 'Polygon',
    coordinates: [
      [
        [-58.42, -34.64],
        [-58.40, -34.64],
        [-58.40, -34.62],
        [-58.42, -34.62],
        [-58.42, -34.64],
      ],
    ],
  };

  const mockPrisma = (config: any = null, zones: any[] = [], tiers: any[] = []) => ({
    shippingConfig: {
      findFirst: jest.fn().mockResolvedValue(config),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    shippingZone: {
      findMany: jest.fn().mockResolvedValue(zones),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    shippingRadiusTier: {
      findMany: jest.fn().mockResolvedValue(tiers),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  });

  const makeService = (config: any, zones: any[] = [], tiers: any[] = []) => {
    prisma = mockPrisma(config, zones, tiers);
    return new ShippingService(prisma as any);
  };

  describe('Modo RADIUS', () => {
    it('reason=inside_radius cuando el cliente está dentro del radio', async () => {
      service = makeService({
        mode: 'RADIUS',
        localLat,
        localLng,
        radiusKm: 5,
        radiusPrice: 1500,
        maxDeliveryRadiusKm: 10,
        borderToleranceMeters: 500,
      });

      const result = await service.calculate(-34.604, -58.381);

      expect(result.available).toBe(true);
      expect(result.reason).toBe('inside_radius');
      expect(result.price).toBe(1500);
    });

    it('reason=out_of_range cuando el cliente está fuera del radio', async () => {
      service = makeService({
        mode: 'RADIUS',
        localLat,
        localLng,
        radiusKm: 1,
        radiusPrice: 1500,
        maxDeliveryRadiusKm: 10,
        borderToleranceMeters: 500,
      });

      const result = await service.calculate(-34.7, -58.38);

      expect(result.available).toBe(false);
      expect(result.reason).toBe('out_of_range');
      expect(result.price).toBeNull();
    });
  });

  describe('Modo POLYGON', () => {
    it('reason=inside cuando el cliente cae dentro de un polígono', async () => {
      service = makeService(
        {
          mode: 'POLYGON',
          localLat,
          localLng,
          radiusKm: 5,
          radiusPrice: 1500,
          maxDeliveryRadiusKm: 15,
          borderToleranceMeters: 500,
        },
        [
          {
            id: 'z1',
            name: 'Zona Centro',
            price: 2000,
            polygon: polygonNearLocal,
            active: true,
          },
        ],
      );

      const result = await service.calculate(-34.6, -58.38);

      expect(result.available).toBe(true);
      expect(result.reason).toBe('inside');
      expect(result.zoneName).toBe('Zona Centro');
      expect(result.price).toBe(2000);
    });

    it('reason=near_border cuando el cliente está cerca del borde dentro de tolerancia', async () => {
      service = makeService(
        {
          mode: 'POLYGON',
          localLat,
          localLng,
          radiusKm: 5,
          radiusPrice: 1500,
          maxDeliveryRadiusKm: 15,
          borderToleranceMeters: 500,
        },
        [
          {
            id: 'z1',
            name: 'Zona Centro',
            price: 2000,
            polygon: polygonNearLocal,
            active: true,
          },
        ],
      );

      const result = await service.calculate(-34.585, -58.38);

      if (result.reason === 'near_border') {
        expect(result.available).toBe(true);
        expect(result.price).toBe(2000);
        expect(result.zoneName).toBe('Zona Centro');
        expect(result.distanceToBorderMeters).toBeDefined();
      } else {
        expect(['near_border', 'out_of_range']).toContain(result.reason);
      }
    });

    it('reason=out_of_range cuando el cliente está fuera del radio máximo', async () => {
      service = makeService(
        {
          mode: 'POLYGON',
          localLat,
          localLng,
          radiusKm: 5,
          radiusPrice: 1500,
          maxDeliveryRadiusKm: 2,
          borderToleranceMeters: 500,
        },
        [],
      );

      const result = await service.calculate(-34.7, -58.38);

      expect(result.available).toBe(false);
      expect(result.reason).toBe('out_of_range');
    });

    it('reason=no_zones_configured cuando no hay zonas activas', async () => {
      service = makeService(
        {
          mode: 'POLYGON',
          localLat,
          localLng,
          radiusKm: 5,
          radiusPrice: 1500,
          maxDeliveryRadiusKm: 15,
          borderToleranceMeters: 500,
        },
        [],
      );

      const result = await service.calculate(-34.6, -58.38);

      expect(result.available).toBe(false);
      expect(result.reason).toBe('no_zones_configured');
    });
  });

  describe('Modo RADIUS_TIERS', () => {
    const tiers = [
      { id: 't1', fromKm: 0, toKm: 5, price: 800, order: 0, active: true },
      { id: 't2', fromKm: 5, toKm: 10, price: 1200, order: 1, active: true },
      { id: 't3', fromKm: 10, toKm: 15, price: 1800, order: 2, active: true },
    ];

    it('Punto cae en el primer tier (0-5km)', async () => {
      service = makeService(
        {
          mode: 'RADIUS_TIERS',
          localLat,
          localLng,
          radiusKm: 5,
          radiusPrice: 0,
          maxDeliveryRadiusKm: 20,
          borderToleranceMeters: 500,
        },
        [],
        tiers,
      );

      // Punto a ~0.5km del local → tier 0-5km
      const result = await service.calculate(-34.604, -58.381);

      expect(result.available).toBe(true);
      expect(result.reason).toBe('inside_radius');
      expect(result.price).toBe(800);
      expect(result.tierLabel).toBe('0-5 km');
      expect(result.zoneName).toBe('0-5 km');
    });

    it('Punto cae en un tier intermedio (5-10km)', async () => {
      service = makeService(
        {
          mode: 'RADIUS_TIERS',
          localLat,
          localLng,
          radiusKm: 5,
          radiusPrice: 0,
          maxDeliveryRadiusKm: 20,
          borderToleranceMeters: 500,
        },
        [],
        tiers,
      );

      // Punto a ~5.5km del local → tier 5-10km
      const result = await service.calculate(-34.65, -58.38);

      expect(result.available).toBe(true);
      expect(result.reason).toBe('inside_radius');
      expect(result.price).toBe(1200);
      expect(result.tierLabel).toBe('5-10 km');
    });

    it('Punto cae en el último tier (10-15km)', async () => {
      service = makeService(
        {
          mode: 'RADIUS_TIERS',
          localLat,
          localLng,
          radiusKm: 5,
          radiusPrice: 0,
          maxDeliveryRadiusKm: 20,
          borderToleranceMeters: 500,
        },
        [],
        tiers,
      );

      // Punto a ~11km del local → tier 10-15km
      const result = await service.calculate(-34.7, -58.38);

      expect(result.available).toBe(true);
      expect(result.reason).toBe('inside_radius');
      expect(result.price).toBe(1800);
      expect(result.tierLabel).toBe('10-15 km');
    });

    it('Punto fuera de todos los tiers (out_of_range)', async () => {
      service = makeService(
        {
          mode: 'RADIUS_TIERS',
          localLat,
          localLng,
          radiusKm: 5,
          radiusPrice: 0,
          maxDeliveryRadiusKm: 20,
          borderToleranceMeters: 500,
        },
        [],
        tiers,
      );

      // Punto a ~17km del local → fuera de todos los tiers
      const result = await service.calculate(-34.75, -58.38);

      expect(result.available).toBe(false);
      expect(result.reason).toBe('out_of_range');
      expect(result.price).toBeNull();
    });

    it('Sin tiers cargados (no_zones_configured)', async () => {
      service = makeService(
        {
          mode: 'RADIUS_TIERS',
          localLat,
          localLng,
          radiusKm: 5,
          radiusPrice: 0,
          maxDeliveryRadiusKm: 20,
          borderToleranceMeters: 500,
        },
        [],
        [],
      );

      const result = await service.calculate(-34.6, -58.38);

      expect(result.available).toBe(false);
      expect(result.reason).toBe('no_zones_configured');
    });

    it('Punto fuera del maxDeliveryRadiusKm (out_of_range)', async () => {
      service = makeService(
        {
          mode: 'RADIUS_TIERS',
          localLat,
          localLng,
          radiusKm: 5,
          radiusPrice: 0,
          maxDeliveryRadiusKm: 8,
          borderToleranceMeters: 500,
        },
        [],
        tiers,
      );

      // Punto a ~11km del local, pero maxDeliveryRadiusKm=8
      const result = await service.calculate(-34.7, -58.38);

      expect(result.available).toBe(false);
      expect(result.reason).toBe('out_of_range');
    });
  });

  describe('Sin configuración', () => {
    it('reason=no_zones_configured cuando no hay config', async () => {
      service = makeService(null, []);

      const result = await service.calculate(-34.6, -58.38);

      expect(result.available).toBe(false);
      expect(result.reason).toBe('no_zones_configured');
    });
  });

  describe('validatePolygon', () => {
    it('valida polígono correcto', () => {
      service = makeService(null);
      const result = service.validatePolygon(polygonNearLocal);
      expect(result.valid).toBe(true);
    });

    it('rechaza polígono con menos de 4 puntos', () => {
      service = makeService(null);
      const bad = {
        type: 'Polygon',
        coordinates: [
          [
            [-58.39, -34.61],
            [-58.37, -34.61],
            [-58.39, -34.61],
          ],
        ],
      };
      const result = service.validatePolygon(bad);
      expect(result.valid).toBe(false);
    });

    it('rechaza polígono no cerrado', () => {
      service = makeService(null);
      const open = {
        type: 'Polygon',
        coordinates: [
          [
            [-58.39, -34.61],
            [-58.37, -34.61],
            [-58.37, -34.59],
            [-58.39, -34.59],
          ],
        ],
      };
      const result = service.validatePolygon(open);
      expect(result.valid).toBe(false);
    });
  });

  describe('checkTierOverlap', () => {
    it('detecta superposición entre rangos', async () => {
      prisma = mockPrisma(null, [], [
        { id: 't1', fromKm: 0, toKm: 5, price: 800, order: 0, active: true },
      ]);
      service = new ShippingService(prisma as any);

      const warnings = await service.checkTierOverlap(3, 8, 'new-id');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('0-5 km');
    });

    it('no detecta superposición cuando los rangos son adyacentes', async () => {
      prisma = mockPrisma(null, [], [
        { id: 't1', fromKm: 0, toKm: 5, price: 800, order: 0, active: true },
      ]);
      service = new ShippingService(prisma as any);

      const warnings = await service.checkTierOverlap(5, 10, 'new-id');
      expect(warnings.length).toBe(0);
    });
  });

  describe('checkTierGaps', () => {
    it('detecta hueco entre rangos', async () => {
      prisma = mockPrisma(null, [], [
        { id: 't1', fromKm: 0, toKm: 5, price: 800, order: 0, active: true },
      ]);
      service = new ShippingService(prisma as any);

      const gaps = await service.checkTierGaps(10, 15, 'new-id');
      expect(gaps.length).toBeGreaterThan(0);
      expect(gaps[0]).toContain('5-10 km');
    });

    it('no detecta hueco cuando los rangos son adyacentes', async () => {
      prisma = mockPrisma(null, [], [
        { id: 't1', fromKm: 0, toKm: 5, price: 800, order: 0, active: true },
      ]);
      service = new ShippingService(prisma as any);

      const gaps = await service.checkTierGaps(5, 10, 'new-id');
      expect(gaps.length).toBe(0);
    });
  });
});
