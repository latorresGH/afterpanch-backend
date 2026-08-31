import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

/**
 * Rango del panel de Estadísticas.
 *
 * Dos formas de pedirlo, a propósito:
 *
 * - `dias=N` → ventana de N jornadas que termina hoy. Es la que usan los
 *   botones 7/14/30 del panel. Va así y no como dos fechas calculadas en el
 *   front porque el front corre en Vercel (UTC) y el negocio vive en UTC-3:
 *   si el navegador armara "hoy menos 7", cerca de la medianoche la ventana
 *   saldría corrida un día. Con `dias` el único que decide qué es "hoy" es el
 *   server, que ya corre en hora argentina.
 *
 * - `desde`/`hasta` → rango explícito, para el selector de fechas. Si viene
 *   cualquiera de los dos, pisa a `dias`.
 *
 * Las fechas van como `YYYY-MM-DD` pelado y no como ISO completo: el día se
 * interpreta en hora del negocio (ver `parseFechaLocal`), y mandar un
 * timestamp con zona invitaría a que el cliente decidiera un límite que le
 * corresponde al server.
 */
export class EstadisticasQueryDto {
  @ApiPropertyOptional({
    description: 'Primer día del rango (YYYY-MM-DD, hora del negocio)',
    example: '2026-08-01',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'desde debe tener el formato YYYY-MM-DD',
  })
  desde?: string;

  @ApiPropertyOptional({
    description:
      'Último día del rango, incluido (YYYY-MM-DD, hora del negocio)',
    example: '2026-08-14',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'hasta debe tener el formato YYYY-MM-DD',
  })
  hasta?: string;

  @ApiPropertyOptional({
    description:
      'Ventana de N días que termina hoy. Se ignora si viene desde/hasta.',
    minimum: 1,
    maximum: 366,
    default: 14,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'dias debe ser un número entero' })
  @Min(1, { message: 'dias debe ser al menos 1' })
  @Max(366, { message: 'dias no puede superar 366' })
  dias?: number;

  @ApiPropertyOptional({
    description:
      'Cuántos productos devuelve el ranking (y para cuántos se calcula el maridaje)',
    minimum: 1,
    maximum: 20,
    default: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'topProductos debe ser un número entero' })
  @Min(1, { message: 'topProductos debe ser al menos 1' })
  @Max(20, { message: 'topProductos no puede superar 20' })
  topProductos?: number;
}
