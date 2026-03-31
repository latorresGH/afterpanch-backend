import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsNumber,
  IsDateString,
  IsArray,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TipoOferta, EstadoOferta } from '@prisma/client';

export class GrupoOpcionDto {
  @IsString()
  productoId: string;
}

export class GrupoComboDto {
  @IsString()
  nombre: string;

  @IsBoolean()
  @IsOptional()
  obligatorio?: boolean;

  @IsNumber()
  @Min(1)
  cantidad: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GrupoOpcionDto)
  opciones: GrupoOpcionDto[];
}

export class OfertaProductoDto {
  @IsString()
  productoId: string;

  @IsBoolean()
  @IsOptional()
  obligatorio?: boolean;

  @IsNumber()
  @Min(1)
  @IsOptional()
  cantidadMin?: number;

  @IsNumber()
  @IsOptional()
  cantidadMax?: number;

  @IsNumber()
  @IsOptional()
  precioEspecial?: number;
}

export class CreateOfertaDto {
  @IsString()
  nombre: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsEnum(TipoOferta)
  tipo: TipoOferta;

  @IsEnum(EstadoOferta)
  @IsOptional()
  estado?: EstadoOferta;

  @IsDateString()
  fechaInicio: string;

  @IsDateString()
  @IsOptional()
  fechaFin?: string;

  @IsBoolean()
  @IsOptional()
  activa?: boolean;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  porcentajeDescuento?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  montoDescuento?: number;

  @IsNumber()
  @IsOptional()
  maxUsosPorCliente?: number;

  @IsNumber()
  @IsOptional()
  maxUsosTotales?: number;

  @IsString()
  @IsOptional()
  diasAplicables?: string;

  @IsString()
  @IsOptional()
  horaInicio?: string;

  @IsString()
  @IsOptional()
  horaFin?: string;

  @IsBoolean()
  @IsOptional()
  aplicaPorLinea?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OfertaProductoDto)
  @IsOptional()
  productos?: OfertaProductoDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GrupoComboDto)
  @IsOptional()
  gruposCombo?: GrupoComboDto[];
}
