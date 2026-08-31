import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Que subconjunto del padron se pide.
 *
 * "Archivado" es `activo = false`. No hay borrado real en esta seccion: dar de
 * baja a un proveedor no puede perder a que proveedor se le compraba cada
 * insumo, asi que el vinculo se conserva y lo unico que cambia es que deja de
 * ofrecerse para asignar.
 */
export enum EstadoProveedor {
  ACTIVOS = 'ACTIVOS',
  ARCHIVADOS = 'ARCHIVADOS',
  TODOS = 'TODOS',
}

/**
 * Ordenes soportados. Enum cerrado y no string libre a proposito: el ORDER BY
 * se arma como SQL literal a partir de este valor, asi que lo unico que
 * garantiza que no entre nada raro es que el ValidationPipe lo rechace antes
 * de llegar al service.
 */
export enum OrdenProveedores {
  /** Los que tienen mas insumos bajo minimo primero: a quien hay que llamar. */
  POR_LLAMAR = 'POR_LLAMAR',
  ALFABETICO = 'ALFABETICO',
  /** Los que mas insumos traen. */
  MAS_INSUMOS = 'MAS_INSUMOS',
  /** Hace mas que no se le repone nada. Los `null` (nunca) van primero. */
  ULTIMA_REPOSICION = 'ULTIMA_REPOSICION',
}

export const PAGE_SIZE_POR_DEFECTO = 24;
export const PAGE_SIZE_MAXIMO = 100;

export class AdminProveedoresQueryDto {
  @ApiPropertyOptional({
    description: 'Busqueda por nombre (case-insensitive, parcial)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({
    enum: EstadoProveedor,
    default: EstadoProveedor.ACTIVOS,
    description:
      'Por defecto ACTIVOS: la pantalla arranca mostrando el padron vigente, ' +
      'no el historico de bajas.',
  })
  @IsOptional()
  @IsEnum(EstadoProveedor, {
    message: `estado debe ser uno de: ${Object.values(EstadoProveedor).join(', ')}`,
  })
  estado?: EstadoProveedor;

  @ApiPropertyOptional({
    description:
      'Atajo de `estado`: true equivale a estado=TODOS (activos + ' +
      'archivados). Si viene `estado` explicito, `estado` gana.',
  })
  @IsOptional()
  // El query string manda "true"/"false" como texto: sin esto, `IsBoolean`
  // rechaza cualquier valor que llegue por URL.
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean({ message: 'incluirArchivados debe ser true o false' })
  incluirArchivados?: boolean;

  @ApiPropertyOptional({
    enum: OrdenProveedores,
    default: OrdenProveedores.POR_LLAMAR,
  })
  @IsOptional()
  @IsEnum(OrdenProveedores, {
    message: `orden debe ser uno de: ${Object.values(OrdenProveedores).join(', ')}`,
  })
  orden?: OrdenProveedores;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page debe ser un numero entero' })
  @Min(1, { message: 'page debe ser al menos 1' })
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: PAGE_SIZE_MAXIMO,
    default: PAGE_SIZE_POR_DEFECTO,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'pageSize debe ser un numero entero' })
  @Min(1, { message: 'pageSize debe ser al menos 1' })
  @Max(PAGE_SIZE_MAXIMO, {
    message: `pageSize no puede superar ${PAGE_SIZE_MAXIMO}`,
  })
  pageSize?: number;
}
