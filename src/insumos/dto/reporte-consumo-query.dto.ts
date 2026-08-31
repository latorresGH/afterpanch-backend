import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

/**
 * Rango del reporte de consumo de insumos.
 *
 * Mismo contrato que el panel de Estadisticas (`EstadisticasQueryDto`), a
 * proposito: son dos reportes por rango y no tiene sentido que se pidan
 * distinto.
 *
 * - `dias=N` → ventana de N jornadas que termina hoy. Va asi y no como dos
 *   fechas calculadas en el front porque el front corre en Vercel (UTC) y el
 *   negocio vive en UTC-3: cerca de la medianoche la ventana saldria corrida
 *   un dia. Con `dias` el unico que decide que es "hoy" es el server.
 * - `desde`/`hasta` → rango explicito. Si viene cualquiera de los dos, pisa a
 *   `dias`.
 */
export class ReporteConsumoQueryDto {
  @ApiPropertyOptional({
    description: 'Primer dia del rango (YYYY-MM-DD, hora del negocio)',
    example: '2026-08-10',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'desde debe tener el formato YYYY-MM-DD',
  })
  desde?: string;

  @ApiPropertyOptional({
    description:
      'Ultimo dia del rango, incluido (YYYY-MM-DD, hora del negocio)',
    example: '2026-08-16',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'hasta debe tener el formato YYYY-MM-DD',
  })
  hasta?: string;

  @ApiPropertyOptional({
    description:
      'Ventana de N dias que termina hoy. Se ignora si viene desde/hasta.',
    minimum: 1,
    maximum: 366,
    default: 7,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'dias debe ser un numero entero' })
  @Min(1, { message: 'dias debe ser al menos 1' })
  @Max(366, { message: 'dias no puede superar 366' })
  dias?: number;

  @ApiPropertyOptional({
    description: 'Cuantos insumos devuelve el ranking del reporte',
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limite debe ser un numero entero' })
  @Min(1, { message: 'limite debe ser al menos 1' })
  @Max(100, { message: 'limite no puede superar 100' })
  limite?: number;
}
