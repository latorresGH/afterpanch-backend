import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../auth/roles.decorator';
import { EstadisticasQueryDto } from './dto/estadisticas-query.dto';
import { StatsService } from './stats.service';

@ApiTags('Estadisticas admin')
@ApiBearerAuth()
@Controller('admin')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('estadisticas')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Panel de Estadisticas del admin',
    description:
      'Compone en una sola request todos los bloques del panel para un rango ' +
      'de fechas: facturacion del periodo con delta contra el anterior, serie ' +
      'diaria, tasa de entrega y conteo por estado, corte por tipo y por ' +
      'metodo de pago, franjas horarias, ranking de productos con su maridaje ' +
      'de salsas y extras, salsas mas pedidas, extras gratis vs cobrados y ' +
      'caja del periodo. Todos los totales los calcula Postgres. ' +
      'El rango se pide con ?dias=N (ventana que termina hoy, por defecto 14) ' +
      'o con ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD, que tiene prioridad.',
  })
  @ApiResponse({ status: 200, description: 'Datos del panel de Estadisticas' })
  @ApiResponse({ status: 400, description: 'Rango invalido' })
  getEstadisticas(@Query() query: EstadisticasQueryDto) {
    return this.statsService.getEstadisticas(query);
  }
}
