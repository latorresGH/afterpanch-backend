import { ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Estado del acceso.
 *
 * `TODOS` es el default porque es lo que la pantalla YA hacía antes de que
 * este filtro existiera: traía activos e inactivos juntos. Cambiar el default
 * a ACTIVOS escondería de golpe a los desactivados de una lista donde hasta
 * ayer aparecían.
 */
export enum EstadoUsuario {
  TODOS = 'TODOS',
  ACTIVOS = 'ACTIVOS',
  INACTIVOS = 'INACTIVOS',
}

/**
 * Query de `GET /admin/usuarios`.
 *
 * Todo opcional: la pantalla arranca sin filtros y con la primera página.
 *
 * ⚠️ `pageSize` tiene un tope duro. Sin clamp, un `?pageSize=999999` convierte
 * el endpoint paginado en el `findAll()` sin paginar que vino a reemplazar —
 * el mismo hallazgo que la auditoría marcó en insumos, extras y aderezos.
 */
export class ListarUsuariosQueryDto {
  @ApiPropertyOptional({
    enum: Role,
    description:
      'Filtra por un rol puntual. Sin esto se listan ADMIN, TRABAJADOR y DELIVERY (el staff).',
  })
  @IsOptional()
  @IsEnum(Role, {
    message: 'rol debe ser uno de: ADMIN, TRABAJADOR, DELIVERY, CLIENTE',
  })
  rol?: Role;

  @ApiPropertyOptional({
    enum: ['TODOS', 'ACTIVOS', 'INACTIVOS'],
    default: 'TODOS',
    description:
      'Filtra por estado del acceso. TODOS (default) mantiene el comportamiento de siempre: activos e inactivos juntos, con los activos primero.',
  })
  @IsOptional()
  @IsEnum(EstadoUsuario, {
    message: 'estado debe ser uno de: TODOS, ACTIVOS, INACTIVOS',
  })
  estado?: EstadoUsuario;

  @ApiPropertyOptional({ description: 'Busca en nombre y email.' })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  buscar?: string;

  @ApiPropertyOptional({
    description:
      'true para incluir también a los CLIENTE. Por defecto quedan fuera: esta pantalla administra al personal del local, no a los clientes finales que se registran desde el menú.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  incluirClientes?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'page arranca en 1' })
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100, { message: 'pageSize no puede pasar de 100' })
  pageSize?: number = 20;
}
