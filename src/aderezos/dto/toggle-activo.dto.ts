import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/**
 * Body de `PATCH /aderezos/:id/activo` y `PATCH /admin/aderezos/:id/activo`.
 *
 * Existe porque el endpoint viejo recibia `@Body() dto: { activo: boolean }`,
 * un tipo inline: TypeScript lo borra al compilar, asi que el ValidationPipe
 * no tenia metadata que mirar y NO VALIDABA NADA. Un body vacio llegaba al
 * service como `undefined` y `Boolean(undefined)` pausaba la salsa en silencio.
 */
export class ToggleActivoAderezoDto {
  @ApiProperty({ description: 'true = visible en la carta, false = pausada.' })
  @IsBoolean({ message: 'activo tiene que ser true o false' })
  activo: boolean;
}
