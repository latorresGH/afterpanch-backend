import { IsBoolean, IsEmail, IsOptional, IsString } from "class-validator";

export class UpdateProveedorDto {
  @IsOptional() @IsString()
  nombre?: string;

  @IsOptional() @IsString()
  telefono?: string;

  @IsOptional() @IsEmail()
  email?: string;

  @IsOptional() @IsString()
  notas?: string;

  @IsOptional() @IsBoolean()
  activo?: boolean;
}
