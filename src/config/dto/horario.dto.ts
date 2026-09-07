import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString, Matches } from 'class-validator';

/**
 * "HH:MM" de 24hs. El mismo regex que usó la migración para decidir si el
 * horario global heredado era confiable, y el mismo que `estaAbierto` aplica
 * al leer: si algo se guardara fuera de este formato el día cae en fail-open y
 * el local queda abierto. Acá es donde se corta antes de que eso pase.
 */
const FORMATO_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const MENSAJE_FORMATO = 'tiene que ser una hora "HH:MM" de 24hs (ej: "19:00")';

/**
 * Body de `PATCH /admin/horario/:dia`.
 *
 * Los tres campos son OBLIGATORIOS aunque el verbo sea PATCH: el recurso es un
 * día entero y son tres campos. Permitir parciales habilita estados a medias
 * —un día marcado abierto con las horas del anterior— por un request que se
 * cortó a la mitad, y el panel manda la fila completa igual.
 */
export class ActualizarHorarioDiaDto {
  @ApiProperty({
    description: 'false = el local no abre ese día (día de descanso).',
  })
  @IsBoolean({ message: 'abierto tiene que ser true o false' })
  abierto: boolean;

  @ApiProperty({ example: '19:00', description: 'Hora de apertura, "HH:MM".' })
  @IsString()
  @Matches(FORMATO_HORA, { message: `desde ${MENSAJE_FORMATO}` })
  desde: string;

  @ApiProperty({
    example: '00:30',
    description:
      'Hora de cierre, "HH:MM". Si es menor o igual que `desde`, el turno cruza la medianoche.',
  })
  @IsString()
  @Matches(FORMATO_HORA, { message: `hasta ${MENSAJE_FORMATO}` })
  hasta: string;
}

/**
 * Body de `PATCH /admin/horario/forzado`.
 *
 * Este flag existe como clave en `Configuracion`, pero NO se escribe por el
 * `POST /config/:clave` genérico: esa ruta acepta cualquier clave con
 * cualquier string y hace un upsert ciego, que es justamente el agujero por el
 * que `stock_bajo_umbral` volvía a existir después de que una migración la
 * borrara. Acá el valor pasa por un boolean de verdad.
 */
export class ActualizarForzadoDto {
  @ApiProperty({
    description:
      'true = el local no toma pedidos, sin importar el horario configurado.',
  })
  @IsBoolean({ message: 'forzado tiene que ser true o false' })
  forzado: boolean;
}
