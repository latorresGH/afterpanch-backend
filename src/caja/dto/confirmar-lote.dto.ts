import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConfirmarLoteDto {
  @ApiProperty({
    description:
      'Ids de los pedidos a confirmar. Máximo 50 por request: cada uno abre ' +
      'su propia transacción, así que un lote sin tope podría tener la ' +
      'conexión ocupada demasiado tiempo.',
    type: [String],
    maxItems: 50,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  pedidoIds: string[];
}
