import { IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateShippingTierDto {
  @ApiProperty({ description: 'Desde km (incluido)' })
  @IsNumber()
  @Min(0)
  fromKm: number;

  @ApiProperty({ description: 'Hasta km (excluido)' })
  @IsNumber()
  @Min(0)
  toKm: number;

  @ApiProperty({ description: 'Precio de envío para este rango' })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({ description: 'Orden visual', required: false })
  @IsNumber()
  @Min(0)
  order?: number;
}
