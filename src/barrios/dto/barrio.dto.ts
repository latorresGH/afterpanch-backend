import { IsString, IsNumber, IsBoolean, IsOptional, Min } from 'class-validator';

export class CreateBarrioDto {
  @IsString()
  nombre: string;

  /**
   * ⚠️ OPCIONAL SOLO COMO RED DE SEGURIDAD, no como flujo normal.
   *
   * El formulario del panel lo exige siempre y no deja guardar vacío: un
   * barrio sin precio explícito es una decisión que nadie tomó, y el costo que
   * el local termina cobrando saldría de un default que no está a la vista.
   * Si el envío a ese barrio es gratis se escribe 0, que sí es una decisión.
   *
   * Se acepta ausente para que un alta por OTRO camino —un script de carga,
   * una migración futura, una integración— no explote con un 400 ni deje el
   * barrio a medio crear. En ese caso el service completa con
   * `delivery_precio_base`, que es exactamente lo que se le cobraría a ese
   * pedido si el barrio no existiera: el fallback no inventa un precio nuevo,
   * usa el que ya regía.
   *
   * Cuando SÍ viene, se valida igual que antes: número y no negativo.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  precioEnvio?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

/**
 * PATCH parcial: lo que no viene, no se toca.
 *
 * ⚠️ Acá `precioEnvio` ausente NO dispara el fallback al precio base, a
 * diferencia del alta. Son dos cosas distintas: en el alta significa "no me
 * dijeron cuánto cobrar" y hay que resolverlo; en la edición significa
 * "dejalo como está", y pisarlo con el base cambiaría en silencio un precio
 * que alguien ya había decidido.
 */
export class UpdateBarrioDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  precioEnvio?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
