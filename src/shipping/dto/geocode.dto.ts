import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GeocodeDto {
  @ApiProperty({ description: 'Dirección a geocodificar', example: 'Av. Corrientes 1234, CABA' })
  @IsString()
  address: string;
}
