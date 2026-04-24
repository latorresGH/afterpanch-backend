import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class SetConsumoCategoriaDto {
  @IsString()
  @IsNotEmpty()
  aderezoId: string;

  @IsString()
  @IsNotEmpty()
  categoriaId: string;

  @IsNumber()
  @Min(0.0001)
  cantidadConsumo: number;
}
