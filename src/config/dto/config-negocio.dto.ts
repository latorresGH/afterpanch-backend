import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Body de `PATCH /admin/config-negocio`.
 *
 * Los tres campos son opcionales: es un PATCH parcial de verdad, el panel
 * manda solo lo que cambió. Pero cada uno que venga se valida con su tipo, que
 * es toda la diferencia con `POST /config/:clave` — esa ruta toma el nombre de
 * la URL y guarda el string que sea, sin mirar nada.
 *
 * ⚠️ `whitelist: true, forbidNonWhitelisted: true` está activo globalmente
 * (main.ts), así que un campo de más en el body es un 400. Eso es lo que
 * convierte esta clase en una whitelist real de las tres claves: no hay forma
 * de colar una cuarta.
 */
export class ActualizarConfigNegocioDto {
  @ApiPropertyOptional({
    example: 3000,
    description:
      'Precio base de delivery, en pesos. Es el que se le cobra a un pedido del menú público; el empleado lo puede ajustar por pedido.',
  })
  @IsOptional()
  // Entero y no float: son pesos, y un costo de envío con centavos no existe
  // en el mostrador. Además `Number(valor)` del lado de lectura devolvería
  // 3000.5 y el input del panel lo mostraría raro.
  @IsInt({ message: 'deliveryPrecioBase tiene que ser un número entero' })
  @Min(0, { message: 'deliveryPrecioBase no puede ser negativo' })
  deliveryPrecioBase?: number;

  @ApiPropertyOptional({
    example: 'afterpanch.mp',
    description:
      'Alias para recibir transferencias. Se muestra en el menú y en el POS.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120, { message: 'El alias es demasiado largo' })
  aliasTransferencia?: string;

  @ApiPropertyOptional({
    example: '5491123456789',
    description:
      'WhatsApp de contacto, con código de país y sin +. Se guarda normalizado a solo dígitos.',
  })
  @IsOptional()
  @IsString()
  // Vacío se acepta: es cómo se apaga el botón de WhatsApp del menú (hoy la
  // clave arranca en '' justamente por eso). Si viene algo, tienen que ser
  // entre 8 y 15 dígitos, admitiendo separadores que el service después saca
  // (E.164 permite hasta 15).
  @Matches(/^$|^[\d\s()+-]{8,25}$/, {
    message:
      'whatsappNumero tiene que ser un número con código de país (ej: 5491123456789), o vacío para no mostrarlo',
  })
  whatsappNumero?: string;
}
