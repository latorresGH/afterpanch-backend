import {
  IsEnum,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
  IsNumber,
} from "class-validator";
import { Type } from "class-transformer";

export enum TipoPedidoDto {
  LOCAL = "LOCAL",
  DELIVERY = "DELIVERY",
  RETIRO = "RETIRO",
}

export enum MetodoPagoDto {
  EFECTIVO = "EFECTIVO",
  TRANSFERENCIA = "TRANSFERENCIA",
  TARJETA = "TARJETA",
}

// create-pedido.dto.ts
export class PedidoExtraDto {
  @IsString()
  extraId: string;

  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  cantidad?: number; // ej 2 sobres / 250 ml / 50 gr
}

export class PedidoDetalleDto {
  @IsString()
  productoId: string;

  @IsInt()
  @Min(1)
  cantidad: number;

  @IsOptional()
  @IsString()
  notas?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  precioUnitario?: number; // editable

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PedidoExtraDto)
  extras?: PedidoExtraDto[];
}

export class CreatePedidoDto {
  @IsEnum(TipoPedidoDto)
  tipo: TipoPedidoDto;

  @IsOptional()
  @IsString()
  nombreCliente?: string;

  @IsOptional()
  @IsString()
  numeroCliente?: string;

  @IsOptional()
  @IsEnum(MetodoPagoDto)
  metodoPago?: MetodoPagoDto;

  @IsOptional()
  @IsString()
  direccion?: string;

  @IsOptional()
  @IsString()
  pedidoId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PedidoDetalleDto)
  detalles: PedidoDetalleDto[];
}