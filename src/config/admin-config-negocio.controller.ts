import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../auth/roles.decorator';
import { NegocioConfigService } from './config.service';
import { ActualizarConfigNegocioDto } from './dto/config-negocio.dto';

/**
 * La pestaña "Configuración" de Ajustes: precio de delivery, alias de
 * transferencia y WhatsApp de contacto.
 *
 * ADMIN en todo, lectura incluida, igual que el resto del panel reworkeado.
 * Lo que consume el menú público sigue siendo `GET /config` (@Public()), que
 * no cambió.
 *
 * ⚠️ POR QUÉ EXISTE, si ya había un `POST /config/:clave`: porque ese endpoint
 * toma el nombre de la clave DE LA URL y hace un upsert con el string que
 * venga, sin validar ni el nombre ni el valor. Es la puerta por la que
 * `stock_bajo_umbral` volvía a existir cada vez que alguien apretaba "Guardar"
 * en el panel viejo, después de que una migración la hubiera borrado. Acá los
 * nombres de las claves están en el código y cada valor pasa por su tipo.
 *
 * El endpoint viejo NO se elimina: el panel desplegado en Vercel todavía lo
 * usa para estas mismas tres claves. Se retira cuando salga el frontend nuevo.
 */
@ApiTags('Configuración')
@ApiBearerAuth()
@Controller('admin/config-negocio')
export class AdminConfigNegocioController {
  constructor(private readonly config: NegocioConfigService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Configuración del negocio',
    description:
      'Precio de delivery, alias de transferencia y WhatsApp, ya tipados (el precio como número, no como el string en que se guarda).',
  })
  get() {
    return this.config.getConfigNegocio();
  }

  @Patch()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Actualizar la configuración del negocio',
    description:
      'PATCH parcial: se actualiza solo lo que venga en el body. Devuelve la configuración completa ya actualizada, para que el panel no tenga que volver a pedirla.',
  })
  actualizar(@Body() dto: ActualizarConfigNegocioDto) {
    return this.config.actualizarConfigNegocio(dto);
  }
}
