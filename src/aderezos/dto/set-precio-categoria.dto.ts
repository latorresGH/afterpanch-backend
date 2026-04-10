import { IsString, IsNumber } from 'class-validator';

export class SetPrecioCategoriaDto {
  @IsString()
  aderezoId: string;

  @IsString()
  categoriaId: string;

  @IsNumber()
  precio: number;
}
