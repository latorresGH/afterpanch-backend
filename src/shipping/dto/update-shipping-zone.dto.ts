import { IsOptional, IsString, IsNumber, IsObject, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateShippingZoneDto {
  @ApiPropertyOptional({ description: 'Nombre de la zona' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Precio de envío para esta zona' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({
    description: 'Polígono GeoJSON: { type: "Polygon", coordinates: [[[lng,lat],...]] }',
  })
  @IsOptional()
  @IsObject()
  polygon?: any;
}
