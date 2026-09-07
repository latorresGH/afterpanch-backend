import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Body de `PATCH /aderezos/:id/sumar` y `PATCH /aderezos/:id/descontar`.
 *
 * Existe por el mismo motivo que `ToggleActivoAderezoDto`: los dos endpoints
 * recibian `@Body() dto: { cantidad: number }` inline y el ValidationPipe no
 * validaba nada. El service igual chequeaba `Number.isFinite(cant) && cant > 0`
 * a mano, asi que no habia agujero de datos — pero el error salia como un 400
 * generico ("Cantidad invalida") en vez de decir que campo estaba mal, y un
 * `{"cantidad": "diez"}` recorria medio service antes de rebotar.
 *
 * ⚠️ ESTOS SON LOS ENDPOINTS DE AJUSTE DE STOCK QUE TIENE QUE USAR EL FRONT
 * NUEVO, no el `PATCH /aderezos/:id` con `stockActual` absoluto. Los dos hacen
 * `increment`/`decrement` atomico en la base y escriben el movimiento; el PATCH
 * con valor absoluto lee, calcula y escribe, y ahi dos ajustes simultaneos (o
 * un ajuste mientras entra un pedido) se pisan.
 */
export class StockMovAderezoDto {
  @ApiProperty({ exclusiveMinimum: true, minimum: 0 })
  @Type(() => Number)
  @IsNumber({}, { message: 'cantidad debe ser un numero' })
  @Min(0.0001, { message: 'cantidad debe ser mayor a 0' })
  cantidad: number;

  @ApiPropertyOptional({
    description:
      'Queda escrito en el movimiento. Si no viene, se arma uno con el signo ' +
      'y la cantidad.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'motivo no puede superar los 200 caracteres' })
  motivo?: string;
}
