import { IsEnum, IsString, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

export class CancelarPedidoDto {
  @IsString()
  @MinLength(1)
  motivo: string;

  @IsEnum(Role)
  rol: Role;
}
