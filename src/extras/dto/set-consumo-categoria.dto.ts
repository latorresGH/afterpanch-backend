import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class SetExtraConsumoCategoriaDto {
  @IsString()
  @IsNotEmpty()
  extraId: string;

  @IsString()
  @IsNotEmpty()
  categoriaId: string;

  @IsNumber()
  @Min(0.0001)
  cantidadConsumo: number;
}
