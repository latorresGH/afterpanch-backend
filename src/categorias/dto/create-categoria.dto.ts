import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateCategoriaDto {
  @IsString()
  nombre: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsInt()
  orden?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  cantExtrasGratis?: number;

  @IsOptional()
  @IsBoolean()
  sinExtrasNiAderezos?: boolean;
}
