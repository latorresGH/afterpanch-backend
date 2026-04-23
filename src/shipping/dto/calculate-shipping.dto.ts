import { IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CalculateShippingDto {
  @ApiProperty({ description: 'Latitud del cliente' })
  @IsNumber()
  lat: number;

  @ApiProperty({ description: 'Longitud del cliente' })
  @IsNumber()
  lng: number;
}
