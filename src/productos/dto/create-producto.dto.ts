import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateProductoDto {
  @IsString()
  nombre: string;

  @IsNumber()
  @Min(0)
  precio: number;

  @IsString()
  categoriaId: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsString()
  imagenUrl?: string;

  @IsOptional()
  @IsString()
  codigo?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  tiempoPreparacionMin?: number;

  @IsArray()
  receta: { insumoId: string; cantidad: number }[];
}
