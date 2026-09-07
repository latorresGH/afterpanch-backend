import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Cuantos pedidos entran en un lote. Vive aca porque aca se valida, y lo
 * importa todo lo que necesita respetarlo (el Home, que arma la lista de ids
 * para el boton "Confirmar todos") para que no haya dos numeros distintos.
 */
export const MAX_CONFIRMAR_LOTE = 50;

export class ConfirmarLoteDto {
  @ApiProperty({
    description:
      'Ids de los pedidos a confirmar. Máximo 50 por request: cada uno abre ' +
      'su propia transacción, así que un lote sin tope podría tener la ' +
      'conexión ocupada demasiado tiempo.',
    type: [String],
    maxItems: MAX_CONFIRMAR_LOTE,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_CONFIRMAR_LOTE)
  @IsUUID('4', { each: true })
  pedidoIds: string[];
}
