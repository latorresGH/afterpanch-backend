import { IsNumber, IsOptional, IsEnum, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TipoMovimientoCaja } from '@prisma/client';

/**
 * Ninguno de estos DTOs acepta `confirmadoPor`, y es a proposito.
 *
 * Hasta ahora el nombre de quien registraba el movimiento llegaba del body:
 * el front mandaba los literales 'Admin' (panel) y 'POS' (caja del POS), y
 * cualquiera con sesion podia mandar el nombre que se le ocurriera. Ahora sale
 * del JWT en el controller (`req.user`), y ademas queda el id real del usuario
 * en `registradoPorId`.
 *
 * Con `forbidNonWhitelisted: true` en el ValidationPipe global, mandar
 * `confirmadoPor` en el body ahora devuelve 400. Es intencional: si quedara
 * algun cliente viejo mandandolo, queremos enterarnos, no que escriba un
 * nombre inventado en silencio.
 */
export class ConfirmarPagoDto {
  @ApiPropertyOptional({
    description:
      'Cuanto de lo cobrado le corresponde al repartidor. Si no viene, se usa ' +
      'el `costoEnvio` que el pedido tenga en ese momento.',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  gananciaRepartidor?: number;
}

export class MovimientoManualDto {
  @ApiProperty({
    enum: ['ENTRADA', 'SALIDA', 'AJUSTE'],
    description:
      'La direccion del movimiento la marca el tipo, no el signo del monto.',
  })
  @IsEnum(['ENTRADA', 'SALIDA', 'AJUSTE'])
  tipo: TipoMovimientoCaja;

  @ApiProperty({
    description:
      'ENTRADA y SALIDA van con monto POSITIVO (el tipo ya dice para que lado ' +
      'va). AJUSTE es la unica excepcion: puede ser negativo, porque una ' +
      'correccion puede ir para cualquiera de los dos lados. El chequeo cruzado ' +
      'contra el tipo lo hace el service.',
  })
  @IsNumber()
  monto: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descripcion?: string;
}
