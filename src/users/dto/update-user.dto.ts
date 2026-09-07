import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  /**
   * Reseteo de contraseña por un administrador.
   *
   * ⚠️ El mínimo es 6 y NO 4: tiene que ser el MISMO que el del alta
   * (`RegisterDto`). Con 4 acá, un admin podía resetear a una contraseña más
   * débil que la que el sistema le habría dejado crear — la regla se saltaba
   * por la puerta de atrás, y encima el frontend tenía que llevar dos mínimos
   * distintos según el formulario.
   */
  @IsOptional()
  @IsString()
  @MinLength(6, {
    message: 'La contraseña necesita al menos 6 caracteres',
  })
  password?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
