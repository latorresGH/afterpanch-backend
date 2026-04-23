import { IsString, IsNumber, IsObject, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateShippingZoneDto {
  @ApiProperty({ description: 'Nombre de la zona' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Precio de envío para esta zona' })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({
    description: 'Polígono GeoJSON: { type: "Polygon", coordinates: [[[lng,lat],...]] }',
  })
  @IsObject()
  polygon: any;
}
