import { IsString, IsNumber, IsBoolean, IsOptional, Min } from 'class-validator';

export class CreateBarrioDto {
  @IsString()
  nombre: string;

  @IsNumber()
  @Min(0)
  precioEnvio: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class UpdateBarrioDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  precioEnvio?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
