import { IsNumber, Min } from 'class-validator';

export class StockMovDto {
  @IsNumber()
  @Min(0.0001)
  cantidad: number;
}
