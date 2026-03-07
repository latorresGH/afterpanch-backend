import { IsBoolean, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CreateExtraDto {
  @IsString()
  nombre: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  precio?: number; // default 500 si no mandas

  @IsOptional()
  @IsNumber()
  @Min(0)
  stockActual?: number; // default 0 si no mandas

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsString()
  categoria?: string; // default ADEREZOS si no mandas
}