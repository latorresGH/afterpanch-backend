import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Que subconjunto del catalogo se lista. */
export enum EstadoProductoFiltro {
  TODOS = 'TODOS',
  ACTIVOS = 'ACTIVOS',
  PAUSADOS = 'PAUSADOS',
}

/**
 * Ordenes soportados. Es un enum cerrado y no un string libre a proposito: el
 * ORDER BY se arma como SQL literal a partir de este valor, asi que lo unico
 * que garantiza que no entre nada raro es que el ValidationPipe lo rechace
 * antes de llegar al service.
 */
export enum OrdenProductos {
  ALFABETICO = 'ALFABETICO',
  MAS_VENDIDOS = 'MAS_VENDIDOS',
  MENOS_VENDIDOS = 'MENOS_VENDIDOS',
  PRECIO_ASC = 'PRECIO_ASC',
  PRECIO_DESC = 'PRECIO_DESC',
}

export const PAGE_SIZE_POR_DEFECTO = 20;
export const PAGE_SIZE_MAXIMO = 100;

export class AdminProductosQueryDto {
  @ApiPropertyOptional({
    description:
      'Busqueda por nombre o descripcion (case-insensitive, parcial)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ description: 'Filtrar por categoria', format: 'uuid' })
  @IsOptional()
  @IsString()
  categoriaId?: string;

  @ApiPropertyOptional({
    enum: EstadoProductoFiltro,
    default: EstadoProductoFiltro.TODOS,
  })
  @IsOptional()
  @IsEnum(EstadoProductoFiltro, {
    message: `estado debe ser uno de: ${Object.values(EstadoProductoFiltro).join(', ')}`,
  })
  estado?: EstadoProductoFiltro;

  @ApiPropertyOptional({
    enum: OrdenProductos,
    default: OrdenProductos.ALFABETICO,
  })
  @IsOptional()
  @IsEnum(OrdenProductos, {
    message: `orden debe ser uno de: ${Object.values(OrdenProductos).join(', ')}`,
  })
  orden?: OrdenProductos;

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

  @ApiPropertyOptional({
    description:
      'Acota las ventas a los ultimos N dias. Sin este parametro, las ventas ' +
      'son el historico completo.',
    minimum: 1,
    maximum: 366,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'dias debe ser un numero entero' })
  @Min(1, { message: 'dias debe ser al menos 1' })
  @Max(366, { message: 'dias no puede superar 366' })
  dias?: number;
}
