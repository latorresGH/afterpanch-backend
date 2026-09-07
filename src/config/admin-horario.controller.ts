import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../auth/roles.decorator';
import { NegocioConfigService } from './config.service';
import {
  ActualizarForzadoDto,
  ActualizarHorarioDiaDto,
} from './dto/horario.dto';

/**
 * El horario de atención del panel, colgado de /admin igual que el resto del
 * rework (/admin/insumos, /admin/extras, /admin/aderezos).
 *
 * ADMIN en TODO, lectura incluida: acá se configura cuándo el negocio toma
 * pedidos, no se consulta. Lo que consumen el menú público y el POS es
 * `GET /config/horario/abierto`, que sigue siendo @Public() y no cambió de
 * forma — ver `NegocioConfigController`.
 */
@ApiTags('Configuración')
@ApiBearerAuth()
@Controller('admin/horario')
export class AdminHorarioController {
  constructor(private readonly config: NegocioConfigService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Horario de la semana',
    description:
      'Las filas de HorarioDia ordenadas por día (0=Lunes … 6=Domingo) más el estado del cierre manual.',
  })
  getSemana() {
    return this.config.getHorarioSemana();
  }

  /**
   * ⚠️ VA ANTES de `@Patch(':dia')` por el orden de resolución de rutas de
   * Nest: declarada después, `forzado` entraría por el parámetro y el
   * ParseIntPipe respondería 400. Mismo caso que `users/me/bienvenida-vista`.
   */
  @Patch('forzado')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Cierre manual del local',
    description:
      'true = el local no toma pedidos, sin importar el horario. Anula el horario entero, y no solo el cartel: POST /pedidos también rechaza.',
  })
  setForzado(@Body() dto: ActualizarForzadoDto) {
    return this.config.setCerradoForzado(dto.forzado);
  }

  @Patch(':dia')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Actualizar un día del horario',
    description:
      'Día de 0 (Lunes) a 6 (Domingo). Si `hasta` es menor o igual que `desde`, el turno cruza la medianoche.',
  })
  actualizarDia(
    @Param('dia', ParseIntPipe) dia: number,
    @Body() dto: ActualizarHorarioDiaDto,
  ) {
    return this.config.actualizarDia(dia, dto);
  }
}
