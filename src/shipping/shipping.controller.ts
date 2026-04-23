import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ShippingService } from './shipping.service';
import { GeocodingService } from './geocoding.service';
import { UpdateShippingConfigDto } from './dto/update-shipping-config.dto';
import { CreateShippingZoneDto } from './dto/create-shipping-zone.dto';
import { UpdateShippingZoneDto } from './dto/update-shipping-zone.dto';
import { CreateShippingTierDto } from './dto/create-shipping-tier.dto';
import { UpdateShippingTierDto } from './dto/update-shipping-tier.dto';
import { GeocodeDto } from './dto/geocode.dto';
import { CalculateShippingDto } from './dto/calculate-shipping.dto';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { Public } from '../auth/public.decorator';

@ApiTags('Shipping')
@Controller('shipping')
export class ShippingController {
  constructor(
    private shippingService: ShippingService,
    private geocodingService: GeocodingService,
  ) {}

  @Get('config')
  @Public()
  @ApiOperation({ summary: 'Obtener configuración de envío actual' })
  getConfig() {
    return this.shippingService.getConfig();
  }

  @Patch('config')
  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Actualizar configuración de envío' })
  updateConfig(@Body() dto: UpdateShippingConfigDto) {
    return this.shippingService.updateConfig(dto as any);
  }

  @Get('zones')
  @Public()
  @ApiOperation({ summary: 'Listar zonas de envío activas' })
  getZones() {
    return this.shippingService.getZones();
  }

  @Post('zones')
  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Crear zona de envío' })
  async createZone(@Body() dto: CreateShippingZoneDto) {
    const validation = this.shippingService.validatePolygon(dto.polygon);
    if (!validation.valid) {
      throw new BadRequestException(validation.error);
    }

    const zone = await this.shippingService.createZone(
      dto.name,
      dto.price,
      dto.polygon,
    );

    const warnings = await this.shippingService.checkOverlap(
      dto.polygon,
      zone.id,
    );

    console.log(`[SHIPPING] Zona creada: ${zone.name}${warnings.length > 0 ? ` — warnings: ${warnings.join(', ')}` : ''}`);
    return { ...zone, warnings };
  }

  @Patch('zones/:id')
  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Editar zona de envío' })
  async updateZone(
    @Param('id') id: string,
    @Body() dto: UpdateShippingZoneDto,
  ) {
    let warnings: string[] = [];

    if (dto.polygon) {
      const validation = this.shippingService.validatePolygon(dto.polygon);
      if (!validation.valid) {
        throw new BadRequestException(validation.error);
      }
      warnings = await this.shippingService.checkOverlap(dto.polygon, id);
    }

    const zone = await this.shippingService.updateZone(id, dto);
    console.log(`[SHIPPING] Zona editada: ${id}`);
    return { ...zone, warnings };
  }

  @Delete('zones/:id')
  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Eliminar zona de envío (soft delete)' })
  deleteZone(@Param('id') id: string) {
    console.log(`[SHIPPING] Zona eliminada (soft): ${id}`);
    return this.shippingService.deleteZone(id);
  }

  // --- RADIUS TIERS ---

  @Get('radius-tiers')
  @Public()
  @ApiOperation({ summary: 'Listar tiers de radio activos' })
  getTiers() {
    return this.shippingService.getTiers();
  }

  @Post('radius-tiers')
  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Crear tier de radio' })
  async createTier(@Body() dto: CreateShippingTierDto) {
    if (dto.toKm <= dto.fromKm) {
      throw new BadRequestException('toKm debe ser mayor que fromKm');
    }

    const tier = await this.shippingService.createTier(dto);

    const overlapWarnings = await this.shippingService.checkTierOverlap(
      dto.fromKm,
      dto.toKm,
      tier.id,
    );

    const gapWarnings = await this.shippingService.checkTierGaps(
      dto.fromKm,
      dto.toKm,
      tier.id,
    );

    const allWarnings = [
      ...overlapWarnings.map((w) => `Superposición con rango ${w}`),
      ...gapWarnings.map((g) => `Hueco detectado: ${g}`),
    ];

    console.log(`[SHIPPING] Tier creado: ${dto.fromKm}-${dto.toKm}km${allWarnings.length > 0 ? ` — warnings: ${allWarnings.join('; ')}` : ''}`);
    return { ...tier, warnings: allWarnings };
  }

  @Patch('radius-tiers/:id')
  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Editar tier de radio' })
  async updateTier(
    @Param('id') id: string,
    @Body() dto: UpdateShippingTierDto,
  ) {
    const existing = await this.shippingService.getTierById(id);

    if (!existing) {
      throw new BadRequestException('Tier no encontrado');
    }

    const fromKm = dto.fromKm ?? existing.fromKm;
    const toKm = dto.toKm ?? existing.toKm;

    if (toKm <= fromKm) {
      throw new BadRequestException('toKm debe ser mayor que fromKm');
    }

    const tier = await this.shippingService.updateTier(id, dto);

    let allWarnings: string[] = [];
    if (dto.fromKm !== undefined || dto.toKm !== undefined) {
      const overlapWarnings = await this.shippingService.checkTierOverlap(
        fromKm,
        toKm,
        id,
      );
      const gapWarnings = await this.shippingService.checkTierGaps(
        fromKm,
        toKm,
        id,
      );
      allWarnings = [
        ...overlapWarnings.map((w) => `Superposición con rango ${w}`),
        ...gapWarnings.map((g) => `Hueco detectado: ${g}`),
      ];
    }

    console.log(`[SHIPPING] Tier editado: ${id}`);
    return { ...tier, warnings: allWarnings };
  }

  @Delete('radius-tiers/:id')
  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Eliminar tier de radio (soft delete)' })
  deleteTier(@Param('id') id: string) {
    console.log(`[SHIPPING] Tier eliminado: ${id}`);
    return this.shippingService.deleteTier(id);
  }

  // --- GEOCODING & CALCULATE ---

  @Post('geocode')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Geocodificar una dirección' })
  geocode(@Body() dto: GeocodeDto) {
    return this.geocodingService.geocode(dto.address);
  }

  @Post('geocode-manual')
  @Public()
  @ApiOperation({ summary: 'Guardar geocoding manual (usuario marca en mapa)' })
  geocodeManual(
    @Body() dto: { address: string; lat: number; lng: number },
  ) {
    if (!dto.address || !dto.address.trim()) {
      throw new BadRequestException('La dirección es obligatoria');
    }
    if (typeof dto.lat !== 'number' || typeof dto.lng !== 'number') {
      throw new BadRequestException('Lat y lng deben ser números');
    }
    return this.geocodingService.geocodeManual(dto.address.trim(), dto.lat, dto.lng);
  }

  @Post('calculate')
  @Public()
  @ApiOperation({ summary: 'Calcular costo de envío para coordenadas' })
  calculate(@Body() dto: CalculateShippingDto) {
    return this.shippingService.calculate(dto.lat, dto.lng);
  }

  // --- GEOCODING CACHE (ADMIN) ---

  @Get('geocoding-cache')
  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Listar entradas del caché de geocoding' })
  getGeocodingCache() {
    return this.geocodingService.getCacheEntries();
  }

  @Delete('geocoding-cache/:id')
  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Eliminar entrada del caché de geocoding' })
  deleteGeocodingCache(@Param('id') id: string) {
    console.log(`[SHIPPING] Entrada de caché eliminada (admin): ${id}`);
    return this.geocodingService.deleteCacheEntry(id);
  }
}
