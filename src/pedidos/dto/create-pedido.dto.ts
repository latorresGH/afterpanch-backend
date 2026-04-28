import {
  IsEnum,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
  IsNumber,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TipoPedidoDto {
  LOCAL = 'LOCAL',
  DELIVERY = 'DELIVERY',
  RETIRO = 'RETIRO',
}

export enum MetodoPagoDto {
  EFECTIVO = 'EFECTIVO',
  TRANSFERENCIA = 'TRANSFERENCIA',
  TARJETA = 'TARJETA',
}

export class PedidoExtraDto {
  @ApiProperty({ description: 'ID del extra/salsa adicional' })
  @IsString()
  extraId: string;

  @ApiPropertyOptional({ description: 'Cantidad del extra', default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  cantidad?: number;
}

export class PedidoDetalleDto {
  @ApiProperty({ description: 'ID del producto' })
  @IsString()
  productoId: string;

  @ApiProperty({ description: 'Cantidad del producto', minimum: 1 })
  @IsInt()
  @Min(1)
  cantidad: number;

  @ApiPropertyOptional({ description: 'Notas adicionales para el producto' })
  @IsOptional()
  @IsString()
  notas?: string;

  @ApiPropertyOptional({
    description: 'Precio unitario (si se quiere sobrescribir)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  precioUnitario?: number;

  @ApiPropertyOptional({
    description:
      'Extras/salsas adicionales. Las primeras 2 unidades son GRATIS, desde la 3ra se cobra.',
    type: [PedidoExtraDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PedidoExtraDto)
  extras?: PedidoExtraDto[];

  @ApiPropertyOptional({
    description: 'IDs de aderezos GRATUITOS (sin límite de cantidad)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aderezosIds?: string[];

  @ApiPropertyOptional({
    description:
      'Si es true, indica que NO se desean extras/salsas adicionales',
  })
  @IsOptional()
  @IsBoolean()
  sinExtras?: boolean;
}

export class CreatePedidoDto {
  @ApiProperty({ description: 'Tipo de pedido', enum: TipoPedidoDto })
  @IsEnum(TipoPedidoDto)
  tipo: TipoPedidoDto;

  @ApiPropertyOptional({ description: 'Nombre del cliente' })
  @IsOptional()
  @IsString()
  nombreCliente?: string;

  @ApiPropertyOptional({ description: 'Apellido del cliente' })
  @IsOptional()
  @IsString()
  apellidoCliente?: string;

  @ApiPropertyOptional({ description: 'Número de teléfono del cliente' })
  @IsOptional()
  @IsString()
  numeroCliente?: string;

  @ApiPropertyOptional({ description: 'Método de pago', enum: MetodoPagoDto })
  @IsOptional()
  @IsEnum(MetodoPagoDto)
  metodoPago?: MetodoPagoDto;

  @ApiPropertyOptional({
    description: 'Dirección de entrega (obligatorio para DELIVERY)',
  })
  @IsOptional()
  @IsString()
  direccion?: string;

  @ApiPropertyOptional({ description: 'Costo de envío' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costoEnvio?: number;

  @ApiPropertyOptional({ description: 'Latitud de la dirección del cliente' })
  @IsOptional()
  @IsNumber()
  direccionLat?: number;

  @ApiPropertyOptional({ description: 'Longitud de la dirección del cliente' })
  @IsOptional()
  @IsNumber()
  direccionLng?: number;

  @ApiPropertyOptional({ description: 'Dirección formateada por el geocoder' })
  @IsOptional()
  @IsString()
  direccionFormateada?: string;

  @ApiPropertyOptional({ description: 'Piso del departamento' })
  @IsOptional()
  @IsString()
  piso?: string;

  @ApiPropertyOptional({ description: 'Departamento' })
  @IsOptional()
  @IsString()
  departamento?: string;

  @ApiPropertyOptional({ description: 'Referencias de la dirección' })
  @IsOptional()
  @IsString()
  referencias?: string;

  @ApiPropertyOptional({ description: 'Notas para el repartidor' })
  @IsOptional()
  @IsString()
  notasRepartidor?: string;

  @ApiPropertyOptional({ description: 'Nombre de la zona de envío aplicada (snapshot)' })
  @IsOptional()
  @IsString()
  shippingZoneName?: string;

  @ApiPropertyOptional({
    description: 'Razón del cálculo de envío: inside | near_border | inside_radius (snapshot)',
  })
  @IsOptional()
  @IsString()
  shippingReason?: string;

  @ApiPropertyOptional({ description: 'Precisión de la dirección: exact | street | manual' })
  @IsOptional()
  @IsString()
  direccionPrecision?: string;

  @ApiPropertyOptional({
    description: 'ID de pedido existente (para agregar más items)',
  })
  @IsOptional()
  @IsString()
  pedidoId?: string;

  @ApiPropertyOptional({ description: 'ID del repartidor asignado' })
  @IsOptional()
  @IsString()
  repartidorId?: string;

  @ApiPropertyOptional({
    description: 'Origen del pedido (MENU = pedido web, no se envía desde POS)',
  })
  @IsOptional()
  @IsString()
  origen?: string;

  @ApiProperty({ description: 'Detalles del pedido', type: [PedidoDetalleDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PedidoDetalleDto)
  detalles: PedidoDetalleDto[];
}
