import { IsNumber, Min } from "class-validator";

export class SumarStockDto {
  @IsNumber()
  @Min(0.0001)
  cantidad: number;
}
