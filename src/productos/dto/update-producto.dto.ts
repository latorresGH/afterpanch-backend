import { IsArray, IsInt, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class UpdateProductoDto {
  @IsOptional() @IsString()
  nombre?: string;

  @IsOptional() @IsNumber()
  @Min(0)
  precio?: number;

  @IsOptional() @IsString()
  categoriaId?: string;

  @IsOptional() @IsString()
  descripcion?: string | null;

  @IsOptional() @IsString()
  codigo?: string | null;

  @IsOptional() @IsInt()
  @Min(0)
  tiempoPreparacionMin?: number | null;

  // si mandan receta => reemplazamos toda
  @IsOptional()
  @IsArray()
  receta?: { insumoId: string; cantidad: number }[];
}
