import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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
} from 'class-validator';

import { MENSAJE_UNIDAD_INVALIDA, UNIDADES_MEDIDA } from '../unidades';

/**
 * Alta de insumo.
 *
 * Hasta ahora el POST entraba como `@Body() body: { ... }` sin DTO: el
 * ValidationPipe no tenia nada que validar, asi que un `stockInicial: "mucho"`
 * o un `proveedorId` inexistente llegaban derecho al service.
 *
 * `stockMinimo` es OBLIGATORIO. Es el cambio de criterio de esta seccion: ya
 * no hay un umbral global del que un insumo pueda colgarse, asi que cada uno
 * tiene que declarar el suyo al nacer. Sin esto el default de la columna
 * decidiria en silencio cuando avisar, que es exactamente lo que se saco.
 */
export class CreateInsumoDto {
  @ApiProperty({ example: 'Muzzarella' })
  @IsString()
  @MinLength(1, { message: 'El nombre no puede estar vacio' })
  @MaxLength(120)
  nombre: string;

  @ApiProperty({
    description: 'Unidad en la que se mide el stock',
    enum: UNIDADES_MEDIDA,
  })
  @IsString()
  @IsIn(UNIDADES_MEDIDA as unknown as string[], {
    message: MENSAJE_UNIDAD_INVALIDA,
  })
  unidadMedida: string;

  @ApiProperty({
    description:
      'Stock con el que arranca. Se acepta 0: un insumo puede darse de alta ' +
      'antes de que llegue la primera compra.',
    minimum: 0,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'stockActual debe ser un numero' })
  @Min(0, { message: 'stockActual no puede ser negativo' })
  stockActual?: number;

  /**
   * Alias historico de `stockActual`. El form que hay hoy en produccion manda
   * `stockInicial`, y con `forbidNonWhitelisted: true` un campo no declarado
   * es un 400: se acepta para que el alta siga funcionando mientras el front
   * no se migra. Cuando el form nuevo este en produccion, se borra.
   *
   * @deprecated usar `stockActual`
   */
  @ApiPropertyOptional({ deprecated: true, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'stockInicial debe ser un numero' })
  @Min(0, { message: 'stockInicial no puede ser negativo' })
  stockInicial?: number;

  @ApiProperty({
    description:
      'Por debajo de este valor el insumo aparece como "bajo minimo". ' +
      'Obligatorio: no hay umbral global del que heredar.',
    exclusiveMinimum: true,
    minimum: 0,
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'stockMinimo debe ser un numero' })
  @Min(0.0001, { message: 'stockMinimo debe ser mayor a 0' })
  stockMinimo: number;

  @ApiPropertyOptional({
    description: 'Proveedor al que se le compra. Opcional.',
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  // `null` es "sin proveedor" y es un valor legitimo, asi que se saltea la
  // validacion de uuid solo para ese caso.
  @ValidateIf((_, valor) => valor !== null)
  @IsUUID('4', { message: 'proveedorId debe ser un uuid' })
  proveedorId?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
