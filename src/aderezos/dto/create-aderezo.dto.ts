import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsArray,
  Min,
} from 'class-validator';

export class CreateAderezoDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  stockActual?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoriaIds?: string[];
}
