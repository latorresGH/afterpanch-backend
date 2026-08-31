import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsUUID, Min } from 'class-validator';

/**
 * Cantidad minima que puede consumir una linea de receta.
 *
 * El punto no es el numero exacto sino que exista un piso mayor a cero: hasta
 * ahora `receta` era un `@IsArray()` pelado y cualquier cosa pasaba. Una
 * cantidad negativa no rebotaba en ningun lado y, como la venta descuenta
 * haciendo `stock - cantidad`, terminaba SUMANDO stock cada vez que se vendia
 * el producto. Con 0.01 entra cualquier gramaje real (0.05 kg de carne, 0.2 l
 * de gaseosa) y queda afuera el 0 y todo lo negativo.
 */
export const CANTIDAD_MINIMA_RECETA = 0.01;

/** Una linea del escandallo: cuanto de un insumo consume una unidad vendida. */
export class RecetaItemDto {
  @ApiProperty({ description: 'Insumo que consume esta linea', format: 'uuid' })
  @IsUUID(undefined, { message: 'insumoId debe ser un uuid valido' })
  insumoId: string;

  @ApiProperty({
    description:
      'Cuanto se consume de ese insumo por unidad vendida, en la unidad de medida del insumo',
    minimum: CANTIDAD_MINIMA_RECETA,
    example: 2,
  })
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: 'cantidad debe ser un numero' },
  )
  @Min(CANTIDAD_MINIMA_RECETA, {
    message: `cantidad debe ser al menos ${CANTIDAD_MINIMA_RECETA}`,
  })
  cantidad: number;
}
