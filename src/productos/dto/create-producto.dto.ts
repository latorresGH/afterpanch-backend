import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

import { RecetaItemDto } from './receta-item.dto';

/** Techo defensivo: ninguna receta real tiene 100 insumos. */
export const MAX_ITEMS_RECETA = 100;

export class CreateProductoDto {
  @ApiProperty()
  @IsString()
  nombre: string;

  @ApiProperty({ minimum: 0 })
  @IsNumber()
  @Min(0)
  precio: number;

  @ApiProperty()
  @IsString()
  categoriaId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imagenUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  codigo?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  tiempoPreparacionMin?: number;

  /**
   * Cada linea se valida de verdad (uuid + cantidad > 0). Antes era
   * `@IsArray()` a secas: entraba cualquier objeto, y una cantidad negativa
   * daba vuelta el signo del descuento de stock en cada venta.
   */
  @ApiProperty({ type: [RecetaItemDto] })
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS_RECETA)
  @ValidateNested({ each: true })
  @Type(() => RecetaItemDto)
  receta: RecetaItemDto[];
}
