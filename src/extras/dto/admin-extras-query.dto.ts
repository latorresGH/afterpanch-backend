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

/** Filtro por nivel de stock. Es ortogonal a `disponibilidad`. */
export enum EstadoStockExtra {
  TODOS = 'TODOS',
  OK = 'OK',
  BAJO = 'BAJO',
  SIN_STOCK = 'SIN_STOCK',
  /** BAJO + SIN_STOCK: la lista de la compra. */
  POR_REPONER = 'POR_REPONER',
}

/** Filtro por alta/baja logica. */
export enum DisponibilidadExtra {
  ACTIVOS = 'ACTIVOS',
  PAUSADOS = 'PAUSADOS',
  TODOS = 'TODOS',
}

/** Filtro por alcance: a que parte de la carta se ofrece. */
export enum AlcanceExtra {
  TODOS = 'TODOS',
  /** `esGlobal = true`: se ofrece en toda la carta. */
  GLOBALES = 'GLOBALES',
  /** Acotado a categorias concretas. */
  POR_CATEGORIA = 'POR_CATEGORIA',
  /**
   * Ni global ni con categorias: NO SE OFRECE EN NINGUN LADO. Es un estado
   * alcanzable y silencioso (el extra existe, esta activo y con stock, pero no
   * aparece nunca), asi que tiene filtro propio para poder encontrarlos.
   */
  SIN_ALCANCE = 'SIN_ALCANCE',
}

/**
 * Ordenes soportados. Enum cerrado y no string libre a proposito: el ORDER BY
 * se arma como SQL literal a partir de este valor, asi que lo unico que
 * garantiza que no entre nada raro es que el ValidationPipe lo rechace antes
 * de llegar al service.
 */
export enum OrdenExtras {
  /** Los mas cerca de quedarse sin nada primero (stock / minimo). */
  POR_REPONER = 'POR_REPONER',
  /** Los mas vendidos de la ventana. */
  MAS_PEDIDOS = 'MAS_PEDIDOS',
  /** Los que mas facturaron en la ventana. */
  MAS_FACTURADO = 'MAS_FACTURADO',
  PRECIO_DESC = 'PRECIO_DESC',
  PRECIO_ASC = 'PRECIO_ASC',
  ALFABETICO = 'ALFABETICO',
}

export const PAGE_SIZE_POR_DEFECTO = 20;
export const PAGE_SIZE_MAXIMO = 100;

/** Ventana sobre la que se miden ventas y facturacion si no la pide el cliente. */
export const DIAS_VENTAS_POR_DEFECTO = 7;

export class AdminExtrasQueryDto {
  @ApiPropertyOptional({
    description: 'Busqueda por nombre (case-insensitive, parcial)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({
    enum: EstadoStockExtra,
    default: EstadoStockExtra.TODOS,
  })
  @IsOptional()
  @IsEnum(EstadoStockExtra, {
    message: `estado debe ser uno de: ${Object.values(EstadoStockExtra).join(', ')}`,
  })
  estado?: EstadoStockExtra;

  @ApiPropertyOptional({
    enum: DisponibilidadExtra,
    default: DisponibilidadExtra.ACTIVOS,
    description:
      'Por defecto ACTIVOS: la pantalla arranca mostrando lo que esta en la ' +
      'carta, no el historico de bajas.',
  })
  @IsOptional()
  @IsEnum(DisponibilidadExtra, {
    message: `disponibilidad debe ser uno de: ${Object.values(DisponibilidadExtra).join(', ')}`,
  })
  disponibilidad?: DisponibilidadExtra;

  @ApiPropertyOptional({ enum: AlcanceExtra, default: AlcanceExtra.TODOS })
  @IsOptional()
  @IsEnum(AlcanceExtra, {
    message: `alcance debe ser uno de: ${Object.values(AlcanceExtra).join(', ')}`,
  })
  alcance?: AlcanceExtra;

  @ApiPropertyOptional({
    description: 'true = solo premium, false = solo comunes. Ausente = todos.',
  })
  @IsOptional()
  @IsString()
  @IsEnum(['true', 'false'], { message: 'premium debe ser true o false' })
  premium?: string;

  @ApiPropertyOptional({
    description: 'uuid de categoria: solo los extras que se ofrecen ahi.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoriaId?: string;

  @ApiPropertyOptional({ enum: OrdenExtras, default: OrdenExtras.POR_REPONER })
  @IsOptional()
  @IsEnum(OrdenExtras, {
    message: `orden debe ser uno de: ${Object.values(OrdenExtras).join(', ')}`,
  })
  orden?: OrdenExtras;

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
      'Ventana en dias sobre la que se miden las ventas y la facturacion de ' +
      'cada extra.',
    minimum: 1,
    maximum: 366,
    default: DIAS_VENTAS_POR_DEFECTO,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'dias debe ser un numero entero' })
  @Min(1, { message: 'dias debe ser al menos 1' })
  @Max(366, { message: 'dias no puede superar 366' })
  dias?: number;
}
