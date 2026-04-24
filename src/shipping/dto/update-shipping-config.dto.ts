import { IsOptional, IsNumber, IsEnum, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum ShippingModeDto {
  RADIUS = 'RADIUS',
  POLYGON = 'POLYGON',
  RADIUS_TIERS = 'RADIUS_TIERS',
}

export class UpdateShippingConfigDto {
  @ApiPropertyOptional({ description: 'Modo de cálculo de envío', enum: ShippingModeDto })
  @IsOptional()
  @IsEnum(ShippingModeDto)
  mode?: ShippingModeDto;

  @ApiPropertyOptional({ description: 'Latitud del local' })
  @IsOptional()
  @IsNumber()
  localLat?: number;

  @ApiPropertyOptional({ description: 'Longitud del local' })
  @IsOptional()
  @IsNumber()
  localLng?: number;

  @ApiPropertyOptional({ description: 'Radio en km (modo RADIUS)' })
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  radiusKm?: number;

  @ApiPropertyOptional({ description: 'Precio dentro del radio (modo RADIUS)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  radiusPrice?: number;

  @ApiPropertyOptional({ description: 'Radio máximo de entrega en km (modo POLYGON)' })
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  maxDeliveryRadiusKm?: number;

  @ApiPropertyOptional({ description: 'Tolerancia al borde en metros (modo POLYGON)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  borderToleranceMeters?: number;
}
