import { IsString, IsNumber, IsOptional, IsEnum } from 'class-validator';
import { TipoMovimientoCaja } from '@prisma/client';

export class ConfirmarPagoDto {
  @IsString()
  confirmadoPor: string;

  @IsOptional()
  @IsNumber()
  gananciaRepartidor?: number;
}

export class MovimientoManualDto {
  @IsEnum(['ENTRADA', 'SALIDA', 'AJUSTE'])
  tipo: TipoMovimientoCaja;

  @IsNumber()
  monto: number;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsString()
  confirmadoPor: string;
}
