import { ApiPropertyOptional } from '@nestjs/swagger';
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
 * Edicion de insumo. Todos los campos son opcionales porque es un PATCH, pero
 * ninguno acepta un valor que deje al insumo en un estado invalido.
 *
 * `stockMinimo` no se puede mandar en 0 ni en negativo: "obligatorio" en un
 * PATCH no significa que tenga que venir siempre, significa que no se puede
 * apagar. Un minimo en 0 seria volver a no tener umbral, que es el agujero que
 * esta seccion cierra.
 */
export class UpdateInsumoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'El nombre no puede estar vacio' })
  @MaxLength(120)
  nombre?: string;

  @ApiPropertyOptional({
    description: 'Umbral de aviso propio del insumo. No puede quedar en 0.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'stockMinimo debe ser un numero' })
  @Min(0.0001, { message: 'stockMinimo debe ser mayor a 0' })
  stockMinimo?: number;

  @ApiPropertyOptional({ enum: UNIDADES_MEDIDA })
  @IsOptional()
  @IsString()
  @IsIn(UNIDADES_MEDIDA as unknown as string[], {
    message: MENSAJE_UNIDAD_INVALIDA,
  })
  unidadMedida?: string;

  /**
   * Fija el stock a un valor absoluto (correccion de recuento), a diferencia
   * de `/sumar` y `/restar`, que son deltas. OJO: este camino NO deja rastro en
   * StockMovimiento — ver la nota en `InsumosService.actualizar`.
   */
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'stockActual debe ser un numero' })
  @Min(0, { message: 'stockActual no puede ser negativo' })
  stockActual?: number;

  @ApiPropertyOptional({
    description: 'uuid del proveedor, o null para desasignarlo.',
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsUUID('4', { message: 'proveedorId debe ser un uuid' })
  proveedorId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
