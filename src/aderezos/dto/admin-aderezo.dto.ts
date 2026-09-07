import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
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
  ValidateNested,
} from 'class-validator';

// La lista de unidades vive en Insumos y ya la comparten Extras y Aderezos. Se
// importa en vez de duplicarse para que las tres secciones no diverjan.
import {
  MENSAJE_UNIDAD_INVALIDA,
  UNIDADES_MEDIDA,
} from '../../insumos/unidades';

/**
 * Tope de filas por lote de configuracion. Hoy el negocio tiene un puñado de
 * categorias; el limite esta para que un body no pueda pedir 10.000 upserts.
 */
const MAX_FILAS_CONFIG = 200;

/**
 * Cuanto stock consume la salsa en UNA categoria.
 *
 * Tiene que ser MAYOR A CERO. Un consumo en 0 seria una salsa que se ofrece y
 * no descuenta nada, que es indistinguible de no tenerla configurada: el
 * agujero que esta regla viene a cerrar. Mismo epsilon que `stockMinimo`.
 */
export class ConsumoAderezoPorCategoriaDto {
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
 * Alta de salsa.
 *
 * ⚠️ NO HAY PRECIO Y NO LO VA A HABER. Las salsas son siempre gratis. La tabla
 * "AderezoPrecio" existe con 0 filas y esta marcada para deprecar: ni este DTO
 * ni el service la tocan.
 *
 * `stockMinimo` es OBLIGATORIO, mismo criterio que `CreateInsumoDto` y
 * `CrearExtraDto`: no hay un umbral global del que colgarse, asi que cada
 * salsa declara el suyo al nacer.
 *
 * `unidadMedida` tambien es obligatoria, y eso SI es nuevo: la columna nacio
 * nullable y 9 de 11 salsas estaban en null. Un consumo de "40" sin unidad no
 * significa nada, y es justo el numero que el POS descuenta al vender.
 *
 * `stockActual` arranca en 0 si no viene. Antes caia a 999 —un default
 * hardcodeado que nadie decidio— y por eso la pantalla nueva pide el stock
 * real al crear.
 *
 * ⚠️ EL CONSUMO ES OBLIGATORIO DONDE LA SALSA SE OFRECE. Una salsa acotada
 * necesita consumo para cada una de sus `categoriaIds`; una `esGlobal`, para
 * TODAS las categorias, porque se ofrece en todas. Eso NO se puede validar en
 * el DTO —depende de que categorias existen y de cuales ya tenia cargadas— asi
 * que lo valida `AdminAderezosService.validarConsumoCompleto` sobre el estado
 * final. Aca solo se valida la forma de cada fila.
 */
export class CrearAderezoDto {
  @ApiProperty({ example: 'Mayonesa' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'nombre es obligatorio' })
  @MinLength(1, { message: 'El nombre no puede estar vacio' })
  @MaxLength(120, { message: 'nombre no puede superar los 120 caracteres' })
  nombre: string;

  @ApiProperty({
    enum: UNIDADES_MEDIDA,
    description:
      'Obligatoria: sin unidad, el consumo por categoria no dice nada.',
  })
  @IsString({ message: 'unidadMedida es obligatoria' })
  @IsIn(UNIDADES_MEDIDA as unknown as string[], {
    message: MENSAJE_UNIDAD_INVALIDA,
  })
  unidadMedida: string;

  @ApiPropertyOptional({
    minimum: 0,
    default: 0,
    description:
      'Stock con el que arranca. Si no viene, 0: la pantalla lo pide ' +
      'explicitamente en el alta.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'stockActual debe ser un numero' })
  @Min(0, { message: 'stockActual no puede ser negativo' })
  stockActual?: number;

  @ApiProperty({
    description: 'Umbral de aviso propio de la salsa. Obligatorio y mayor a 0.',
    exclusiveMinimum: true,
    minimum: 0,
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'stockMinimo debe ser un numero' })
  @Min(0.0001, { message: 'stockMinimo debe ser mayor a 0' })
  stockMinimo: number;

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
    type: [String],
    description: 'Categorias donde se ofrece. Se ignora si `esGlobal` es true.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILAS_CONFIG)
  @IsUUID(undefined, { each: true, message: 'categoriaIds debe traer uuids' })
  categoriaIds?: string[];

  @ApiPropertyOptional({ type: [ConsumoAderezoPorCategoriaDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILAS_CONFIG)
  @ValidateNested({ each: true })
  @Type(() => ConsumoAderezoPorCategoriaDto)
  consumos?: ConsumoAderezoPorCategoriaDto[];
}

/**
 * Edicion de salsa. Todos los campos son opcionales porque es un PATCH, pero
 * ninguno acepta un valor que la deje en un estado invalido.
 *
 * `stockMinimo` y `unidadMedida` no se pueden apagar: "obligatorio" en un
 * PATCH no significa que tengan que venir siempre, significa que no se pueden
 * mandar vacios ni en 0. Es la misma redaccion que `UpdateInsumoDto` y
 * `EditarExtraDto`, y el mismo motivo.
 *
 * Los dos bloques de configuracion (`categoriaIds`, `consumos`) son REEMPLAZO
 * COMPLETO cuando vienen: el que manda define el set entero para esa salsa.
 * Mandar `[]` borra todas las filas de ese bloque; no mandar la clave las deja
 * como estaban.
 */
export class EditarAderezoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1, { message: 'El nombre no puede estar vacio' })
  @MaxLength(120, { message: 'nombre no puede superar los 120 caracteres' })
  nombre?: string;

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
  activo?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  esGlobal?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILAS_CONFIG)
  @IsUUID(undefined, { each: true, message: 'categoriaIds debe traer uuids' })
  categoriaIds?: string[];

  @ApiPropertyOptional({ type: [ConsumoAderezoPorCategoriaDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILAS_CONFIG)
  @ValidateNested({ each: true })
  @Type(() => ConsumoAderezoPorCategoriaDto)
  consumos?: ConsumoAderezoPorCategoriaDto[];
}

/**
 * Body de `PATCH /aderezos/:id`, el CRUD viejo que todavia usa el panel actual.
 *
 * Es `EditarAderezoDto` SIN `consumos` a proposito: ese endpoint no sabe
 * guardar el consumo por categoria (para eso esta
 * `POST /aderezos/consumo-categoria`, que es lo que llama el modal viejo), asi
 * que aceptarlo en el body seria tragarselo en silencio. Con el ValidationPipe
 * en `forbidNonWhitelisted`, mandarlo ahora devuelve un 400 explicito.
 *
 * ⚠️ ESTE ENDPOINT NO EXIGE EL CONSUMO COMPLETO. La regla "donde la salsa se
 * ofrece tiene que estar cargado cuanto consume" la aplica solo
 * `AdminAderezosService`. Es deliberado: el modal viejo guarda primero la salsa
 * y recien despues los consumos uno por uno, asi que validarlo aca romperia el
 * panel actual antes de que llegue el nuevo. Mismo criterio que quedo en
 * Extras. PENDIENTE: cuando el front nuevo reemplace al modal viejo, este
 * endpoint puede endurecerse o directamente sacarse.
 */
export class UpdateAderezoLegacyDto extends OmitType(EditarAderezoDto, [
  'consumos',
] as const) {}
