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

/**
 * Filtro por estado de stock. Es ortogonal a `disponibilidad`: uno mira cuanto
 * queda, el otro si el insumo esta en juego.
 */
export enum EstadoStock {
  TODOS = 'TODOS',
  OK = 'OK',
  BAJO = 'BAJO',
  SIN_STOCK = 'SIN_STOCK',
  /** BAJO + SIN_STOCK: la lista de la compra. */
  POR_REPONER = 'POR_REPONER',
}

/** Filtro por alta/baja logica. */
export enum DisponibilidadInsumo {
  ACTIVOS = 'ACTIVOS',
  PAUSADOS = 'PAUSADOS',
  TODOS = 'TODOS',
}

/**
 * Ordenes soportados. Enum cerrado y no string libre a proposito: el ORDER BY
 * se arma como SQL literal a partir de este valor, asi que lo unico que
 * garantiza que no entre nada raro es que el ValidationPipe lo rechace antes
 * de llegar al service.
 */
export enum OrdenInsumos {
  /** Los mas cerca de quedarse sin nada primero (stock / minimo). */
  POR_REPONER = 'POR_REPONER',
  /** Los que mas se gastan en la ventana de consumo. */
  CONSUMO = 'CONSUMO',
  ALFABETICO = 'ALFABETICO',
  STOCK_ASC = 'STOCK_ASC',
  STOCK_DESC = 'STOCK_DESC',
}

/**
 * Valor especial de `proveedorId` para pedir los que no tienen ninguno.
 * Va como sentinela y no como flag aparte porque en la pantalla es una opcion
 * mas del mismo selector.
 */
export const SIN_PROVEEDOR = 'SIN_PROVEEDOR';

export const PAGE_SIZE_POR_DEFECTO = 25;
export const PAGE_SIZE_MAXIMO = 100;

/** Ventana sobre la que se mide el consumo diario si no la pide el cliente. */
export const DIAS_CONSUMO_POR_DEFECTO = 7;

export class AdminInsumosQueryDto {
  @ApiPropertyOptional({
    description: 'Busqueda por nombre (case-insensitive, parcial)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ enum: EstadoStock, default: EstadoStock.TODOS })
  @IsOptional()
  @IsEnum(EstadoStock, {
    message: `estado debe ser uno de: ${Object.values(EstadoStock).join(', ')}`,
  })
  estado?: EstadoStock;

  @ApiPropertyOptional({
    enum: DisponibilidadInsumo,
    default: DisponibilidadInsumo.ACTIVOS,
    description:
      'Por defecto ACTIVOS: la pantalla arranca mostrando lo que esta en ' +
      'juego, no el historico de bajas.',
  })
  @IsOptional()
  @IsEnum(DisponibilidadInsumo, {
    message: `disponibilidad debe ser uno de: ${Object.values(DisponibilidadInsumo).join(', ')}`,
  })
  disponibilidad?: DisponibilidadInsumo;

  @ApiPropertyOptional({
    description: `uuid del proveedor, o "${SIN_PROVEEDOR}" para los que no tienen`,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  proveedorId?: string;

  @ApiPropertyOptional({
    enum: OrdenInsumos,
    default: OrdenInsumos.POR_REPONER,
  })
  @IsOptional()
  @IsEnum(OrdenInsumos, {
    message: `orden debe ser uno de: ${Object.values(OrdenInsumos).join(', ')}`,
  })
  orden?: OrdenInsumos;

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
      'Ventana en dias sobre la que se promedia el consumo diario de cada ' +
      'insumo (y con el que se calculan los dias de aguante).',
    minimum: 1,
    maximum: 366,
    default: DIAS_CONSUMO_POR_DEFECTO,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'dias debe ser un numero entero' })
  @Min(1, { message: 'dias debe ser al menos 1' })
  @Max(366, { message: 'dias no puede superar 366' })
  dias?: number;
}
