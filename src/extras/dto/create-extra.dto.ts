import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsArray,
  Min,
} from 'class-validator';

export class CreateExtraDto {
  @IsString()
  nombre: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  precio?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  stockActual?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsString()
  categoria?: string;

  @IsOptional()
  @IsString()
  unidadMedida?: string;

  @IsOptional()
  @IsString()
  insumoId?: string | null;

  @IsOptional()
  @IsBoolean()
  esGlobal?: boolean;

  @IsOptional()
  @IsBoolean()
  esPremium?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoriaIds?: string[];
}
