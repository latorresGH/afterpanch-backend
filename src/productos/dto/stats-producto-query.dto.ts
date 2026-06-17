import { IsDateString, IsNotEmpty } from 'class-validator';

export class StatsProductoQueryDto {
  @IsNotEmpty({ message: 'fechaInicio es requerida' })
  @IsDateString({}, { message: 'fechaInicio debe ser una fecha válida (YYYY-MM-DD)' })
  fechaInicio: string;

  @IsNotEmpty({ message: 'fechaFin es requerida' })
  @IsDateString({}, { message: 'fechaFin debe ser una fecha válida (YYYY-MM-DD)' })
  fechaFin: string;
}
