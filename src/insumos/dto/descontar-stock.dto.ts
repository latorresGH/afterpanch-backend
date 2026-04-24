import { IsNumber, Min, IsOptional, IsString } from 'class-validator';

export class DescontarStockDto {
  @IsNumber()
  @Min(0.000001, { message: 'La cantidad a descontar debe ser mayor a 0' })
  cantidad: number;

  @IsOptional()
  @IsString()
  motivo?: string;
}
