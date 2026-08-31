import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// La lista de unidades vive en Insumos y ya contempla a los Extras: su propio
// comentario documenta `un` como "el default con el que se crean los Extras".
// Se importa en vez de duplicarse para que las dos secciones no diverjan.
import {
  MENSAJE_UNIDAD_INVALIDA,
  UNIDADES_MEDIDA,
} from '../../insumos/unidades';

/**
 * Tope de filas por lote de configuracion. Hoy el negocio tiene un puñado de
 * categorias; el limite esta para que un body no pueda pedir 10.000 upserts.
 */
const MAX_FILAS_CONFIG = 200;

/** Precio de un extra para UNA categoria. Sobrescribe el precio base. */
export class PrecioPorCategoriaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'categoriaId debe ser un uuid' })
  categoriaId: string;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsNumber({}, { message: 'precio debe ser un numero' })
  @Min(0, { message: 'precio no puede ser negativo' })
  precio: number;
}

/**
 * Cuanto stock consume el extra en UNA categoria.
 *
 * Tiene que ser MAYOR A CERO. Un consumo en 0 seria un extra que se ofrece y
 * no descuenta nada, que es indistinguible de no tenerlo configurado: el
 * agujero que esta regla viene a cerrar. Mismo epsilon que `stockMinimo`.
 */
export class ConsumoPorCategoriaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'categoriaId debe ser un uuid' })
  categoriaId: string;

  @ApiProperty({ exclusiveMinimum: true, minimum: 0 })
  @Type(() => Number)
  @IsNumber({}, { message: 'cantidadConsumo debe ser un numero' })
  @Min(0.0001, { message: 'cantidadConsumo debe ser mayor a 0' })
  cantidadConsumo: number;
}

/**
 * Alta de extra.
 *
 * `stockMinimo` es OBLIGATORIO, mismo criterio que `CreateInsumoDto`: no hay
 * un umbral global del que colgarse, asi que cada extra declara el suyo al
 * nacer. Sin esto el default de la columna (10) decidiria en silencio cuando
 * avisar, que es exactamente lo que se quiere evitar.
 *
 * Los tres bloques de configuracion (`categoriaIds`, `precios`, `consumos`)
 * son opcionales y se guardan en la misma transaccion que el extra. Van juntos
 * a proposito: alcance, precio y consumo son tres tablas paralelas con la
 * misma forma, y que se puedan editar por separado es justamente lo que hace
 * que queden desalineadas.
 *
 * ⚠️ EL CONSUMO ES OBLIGATORIO DONDE EL EXTRA SE OFRECE. Un extra acotado
 * necesita consumo para cada una de sus `categoriaIds`; uno `esGlobal`, para
 * TODAS las categorias, porque se ofrece en todas. Eso NO se puede validar en
 * el DTO —depende de que categorias existen y de cuales ya tenia cargadas—
 * asi que lo valida `AdminExtrasService.validarConsumoCompleto` sobre el
 * estado final. Aca solo se valida la forma de cada fila.
 */
export class CrearExtraDto {
  @ApiProperty({ example: 'Cheddar extra' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'nombre es obligatorio' })
  @MinLength(1, { message: 'El nombre no puede estar vacio' })
  @MaxLength(120, { message: 'nombre no puede superar los 120 caracteres' })
  nombre: string;

  @ApiPropertyOptional({
    minimum: 0,
    default: 500,
    description: 'Precio base.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'precio debe ser un numero' })
  @Min(0, { message: 'precio no puede ser negativo' })
  precio?: number;

  @ApiPropertyOptional({ enum: UNIDADES_MEDIDA, default: 'un' })
  @IsOptional()
  @IsString()
  @IsIn(UNIDADES_MEDIDA as unknown as string[], {
    message: MENSAJE_UNIDAD_INVALIDA,
  })
  unidadMedida?: string;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'stockActual debe ser un numero' })
  @Min(0, { message: 'stockActual no puede ser negativo' })
  stockActual?: number;

  @ApiProperty({
    description: 'Umbral de aviso propio del extra. Obligatorio y mayor a 0.',
    exclusiveMinimum: true,
    minimum: 0,
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'stockMinimo debe ser un numero' })
  @Min(0.0001, { message: 'stockMinimo debe ser mayor a 0' })
  stockMinimo: number;

  @ApiPropertyOptional({
    default: false,
    description:
      'Premium: siempre se cobra y no consume un cupo de los extras gratis.',
  })
  @IsOptional()
  @IsBoolean()
  esPremium?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'true = se ofrece en toda la carta, ignorando `categoriaIds`.',
  })
  @IsOptional()
  @IsBoolean()
  esGlobal?: boolean;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Insumo del que descuenta. Si viene, el stock sale del insumo y no del ' +
      'extra. `null` = stock propio.',
  })
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsUUID(undefined, { message: 'insumoId debe ser un uuid' })
  insumoId?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'Categorias donde se ofrece. Se ignora si `esGlobal` es true.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILAS_CONFIG)
  @IsUUID(undefined, { each: true, message: 'categoriaIds debe traer uuids' })
  categoriaIds?: string[];

  @ApiPropertyOptional({ type: [PrecioPorCategoriaDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILAS_CONFIG)
  @ValidateNested({ each: true })
  @Type(() => PrecioPorCategoriaDto)
  precios?: PrecioPorCategoriaDto[];

  @ApiPropertyOptional({ type: [ConsumoPorCategoriaDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILAS_CONFIG)
  @ValidateNested({ each: true })
  @Type(() => ConsumoPorCategoriaDto)
  consumos?: ConsumoPorCategoriaDto[];
}

/**
 * Edicion de extra. Todos los campos son opcionales porque es un PATCH, pero
 * ninguno acepta un valor que deje al extra en un estado invalido.
 *
 * `stockMinimo` no se puede mandar en 0 ni en negativo: "obligatorio" en un
 * PATCH no significa que tenga que venir siempre, significa que no se puede
 * apagar. Es la misma redaccion que `UpdateInsumoDto`, y el mismo motivo.
 *
 * Los tres arrays de configuracion son REEMPLAZO COMPLETO cuando vienen: el
 * que manda define el set entero para ese extra. Mandar `[]` borra todas las
 * filas de ese bloque; no mandar la clave las deja como estaban.
 */
export class EditarExtraDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1, { message: 'El nombre no puede estar vacio' })
  @MaxLength(120, { message: 'nombre no puede superar los 120 caracteres' })
  nombre?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'precio debe ser un numero' })
  @Min(0, { message: 'precio no puede ser negativo' })
  precio?: number;

  @ApiPropertyOptional({ enum: UNIDADES_MEDIDA })
  @IsOptional()
  @IsString()
  @IsIn(UNIDADES_MEDIDA as unknown as string[], {
    message: MENSAJE_UNIDAD_INVALIDA,
  })
  unidadMedida?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'stockActual debe ser un numero' })
  @Min(0, { message: 'stockActual no puede ser negativo' })
  stockActual?: number;

  @ApiPropertyOptional({
    description: 'Umbral de aviso propio. No puede quedar en 0.',
    exclusiveMinimum: true,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'stockMinimo debe ser un numero' })
  @Min(0.0001, { message: 'stockMinimo debe ser mayor a 0' })
  stockMinimo?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  esPremium?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  esGlobal?: boolean;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsUUID(undefined, { message: 'insumoId debe ser un uuid' })
  insumoId?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILAS_CONFIG)
  @IsUUID(undefined, { each: true, message: 'categoriaIds debe traer uuids' })
  categoriaIds?: string[];

  @ApiPropertyOptional({ type: [PrecioPorCategoriaDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILAS_CONFIG)
  @ValidateNested({ each: true })
  @Type(() => PrecioPorCategoriaDto)
  precios?: PrecioPorCategoriaDto[];

  @ApiPropertyOptional({ type: [ConsumoPorCategoriaDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILAS_CONFIG)
  @ValidateNested({ each: true })
  @Type(() => ConsumoPorCategoriaDto)
  consumos?: ConsumoPorCategoriaDto[];
}
