import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { Role } from "@prisma/client";

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  nombre: string;

  @IsString()
  @MinLength(4)
  password: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role; // ADMIN | TRABAJADOR | DELIVERY | CLIENTE
}
