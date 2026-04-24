import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsArray,
  IsBoolean,
  Min,
} from 'class-validator';

export class CreateAderezoDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  stockActual?: number;

  @IsOptional()
  @IsString()
  unidadMedida?: string;

  @IsOptional()
  @IsBoolean()
  esGlobal?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoriaIds?: string[];
}
