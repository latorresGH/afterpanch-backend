import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateInsumoDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  stockMinimo?: number;

  @IsOptional()
  @IsString()
  unidadMedida?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  stockActual?: number;

  // ✅ asignar / sacar proveedor
  @IsOptional()
  @IsString()
  proveedorId?: string | null;

  // ✅ alta/baja lógica
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
