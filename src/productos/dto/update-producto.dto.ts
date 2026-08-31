import { ApiPropertyOptional } from '@nestjs/swagger';
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

import { MAX_ITEMS_RECETA } from './create-producto.dto';
import { RecetaItemDto } from './receta-item.dto';

export class UpdateProductoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  precio?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoriaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descripcion?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imagenUrl?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  codigo?: string | null;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  tiempoPreparacionMin?: number | null;

  /**
   * Si viene, REEMPLAZA la receta entera (no es un patch por linea). Mismas
   * reglas que en el alta: uuid valido y cantidad mayor a cero.
   */
  @ApiPropertyOptional({ type: [RecetaItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS_RECETA)
  @ValidateNested({ each: true })
  @Type(() => RecetaItemDto)
  receta?: RecetaItemDto[];
}
