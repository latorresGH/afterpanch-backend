import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Techo duro del historial: sin clamp, `?limit=999999` se traia la tabla. */
export const LIMITE_MOVIMIENTOS_MAXIMO = 200;
export const LIMITE_MOVIMIENTOS_POR_DEFECTO = 50;

export class MovimientosQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: LIMITE_MOVIMIENTOS_MAXIMO,
    default: LIMITE_MOVIMIENTOS_POR_DEFECTO,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un numero entero' })
  @Min(1, { message: 'limit debe ser al menos 1' })
  @Max(LIMITE_MOVIMIENTOS_MAXIMO, {
    message: `limit no puede superar ${LIMITE_MOVIMIENTOS_MAXIMO}`,
  })
  limit?: number;
}
