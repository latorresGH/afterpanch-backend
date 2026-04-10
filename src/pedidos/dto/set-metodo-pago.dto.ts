import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum MetodoPagoDto {
  EFECTIVO = 'EFECTIVO',
  TRANSFERENCIA = 'TRANSFERENCIA',
  TARJETA = 'TARJETA',
}

export class SetMetodoPagoDto {
  @IsOptional()
  @IsEnum(MetodoPagoDto)
  metodoPago?: MetodoPagoDto;

  @IsOptional()
  @IsString()
  numeroCliente?: string;
}
