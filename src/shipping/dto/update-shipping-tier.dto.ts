import { IsOptional, IsNumber, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateShippingTierDto {
  @ApiPropertyOptional({ description: 'Desde km (incluido)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  fromKm?: number;

  @ApiPropertyOptional({ description: 'Hasta km (excluido)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  toKm?: number;

  @ApiPropertyOptional({ description: 'Precio de envío para este rango' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ description: 'Orden visual' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  order?: number;
}
