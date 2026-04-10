import { IsString, IsNumber, Min } from 'class-validator';

export class SetExtraPrecioCategoriaDto {
  @IsString()
  extraId: string;

  @IsString()
  categoriaId: string;

  @IsNumber()
  @Min(0)
  precio: number;
}
