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
export enum EstadoStockAderezo {
  TODOS = 'TODOS',
  OK = 'OK',
  BAJO = 'BAJO',
  SIN_STOCK = 'SIN_STOCK',
  /** BAJO + SIN_STOCK: la lista de la compra. */
  POR_REPONER = 'POR_REPONER',
}

/** Filtro por alta/baja logica. Son las "vistas" del mockup. */
export enum DisponibilidadAderezo {
  ACTIVOS = 'ACTIVOS',
  PAUSADOS = 'PAUSADOS',
  TODOS = 'TODOS',
}

/** Filtro por alcance: a que parte de la carta se ofrece la salsa. */
export enum AlcanceAderezo {
  TODOS = 'TODOS',
  /** `esGlobal = true`: se ofrece en toda la carta. */
  GLOBALES = 'GLOBALES',
  /** Acotada a categorias concretas. */
  POR_CATEGORIA = 'POR_CATEGORIA',
  /**
   * Ni global ni con categorias: NO SE OFRECE EN NINGUN LADO. Es un estado
   * alcanzable y silencioso (la salsa existe, esta activa y con stock, pero no
   * aparece nunca), asi que tiene filtro propio para poder encontrarlas. Hoy
   * hay salsas asi en la base, por eso el filtro no es teorico.
   */
  SIN_ALCANCE = 'SIN_ALCANCE',
}

/**
 * Ordenes soportados. Enum cerrado y no string libre a proposito: el ORDER BY
 * se arma como SQL literal a partir de este valor, asi que lo unico que
 * garantiza que no entre nada raro es que el ValidationPipe lo rechace antes
 * de llegar al service.
 */
export enum OrdenAderezos {
  /** Las mas cerca de quedarse sin nada primero (stock / minimo). */
  POR_REPONER = 'POR_REPONER',
  /**
   * Las que menos aguantan al ritmo de la ventana (stock / consumo diario).
   * Es el orden que muestra el mockup por defecto. Las que no tienen consumo
   * medido van al final: no aguantan "infinito", no se puede estimar.
   */
  AGUANTE = 'AGUANTE',
  /** Las que mas se consumieron en la ventana. */
  CONSUMO = 'CONSUMO',
  STOCK_DESC = 'STOCK_DESC',
  STOCK_ASC = 'STOCK_ASC',
  ALFABETICO = 'ALFABETICO',
}

export const PAGE_SIZE_POR_DEFECTO = 20;
export const PAGE_SIZE_MAXIMO = 100;

/** Ventana sobre la que se mide el consumo si no la pide el cliente. */
export const DIAS_CONSUMO_POR_DEFECTO = 7;

export class AdminAderezosQueryDto {
  @ApiPropertyOptional({
    description: 'Busqueda por nombre (case-insensitive, parcial)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({
    enum: EstadoStockAderezo,
    default: EstadoStockAderezo.TODOS,
  })
  @IsOptional()
  @IsEnum(EstadoStockAderezo, {
    message: `estado debe ser uno de: ${Object.values(EstadoStockAderezo).join(', ')}`,
  })
  estado?: EstadoStockAderezo;

  @ApiPropertyOptional({
    enum: DisponibilidadAderezo,
    default: DisponibilidadAderezo.ACTIVOS,
    description:
      'Por defecto ACTIVOS: la pantalla arranca mostrando lo que esta en la ' +
      'carta, no el historico de bajas.',
  })
  @IsOptional()
  @IsEnum(DisponibilidadAderezo, {
    message: `disponibilidad debe ser uno de: ${Object.values(DisponibilidadAderezo).join(', ')}`,
  })
  disponibilidad?: DisponibilidadAderezo;

  @ApiPropertyOptional({ enum: AlcanceAderezo, default: AlcanceAderezo.TODOS })
  @IsOptional()
  @IsEnum(AlcanceAderezo, {
    message: `alcance debe ser uno de: ${Object.values(AlcanceAderezo).join(', ')}`,
  })
  alcance?: AlcanceAderezo;

  @ApiPropertyOptional({
    description: 'uuid de categoria: solo las salsas que se ofrecen ahi.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoriaId?: string;

  @ApiPropertyOptional({
    enum: OrdenAderezos,
    default: OrdenAderezos.POR_REPONER,
  })
  @IsOptional()
  @IsEnum(OrdenAderezos, {
    message: `orden debe ser uno de: ${Object.values(OrdenAderezos).join(', ')}`,
  })
  orden?: OrdenAderezos;

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
      'Ventana en dias sobre la que se mide el consumo diario y el aguante ' +
      'de cada salsa.',
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
