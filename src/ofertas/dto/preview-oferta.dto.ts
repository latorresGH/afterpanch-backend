import {
  IsString,
  IsNumber,
  IsArray,
  ValidateNested,
  Min,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PreviewExtraDto {
  @IsString()
  extraId: string;

  @IsNumber()
  @Min(1)
  cantidad: number;

  @IsNumber()
  @IsOptional()
  precio?: number;
}

export class PreviewLineaDto {
  @IsString()
  productoId: string;

  @IsNumber()
  @Min(1)
  cantidad: number;

  @IsNumber()
  @IsOptional()
  precioUnitario?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreviewExtraDto)
  @IsOptional()
  extras?: PreviewExtraDto[];
}

export class PreviewOfertaDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreviewLineaDto)
  lineas: PreviewLineaDto[];
}
