import { IsEmail, IsOptional, IsString } from 'class-validator';

export class CreateProveedorDto {
  @IsString()
  nombre: string;

  @IsOptional()
  @IsString()
  telefono?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  notas?: string;
}
