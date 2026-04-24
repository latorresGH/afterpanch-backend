import { IsNumber, Min, IsOptional, IsString } from 'class-validator';

export class SumarStockDto {
  @IsNumber()
  @Min(0.0001)
  cantidad: number;

  @IsOptional()
  @IsString()
  motivo?: string;
}
