import { Module } from '@nestjs/common';
import { NegocioConfigService } from './config.service';
import { NegocioConfigController } from './config.controller';
import { AdminHorarioController } from './admin-horario.controller';
import { AdminConfigNegocioController } from './admin-config-negocio.controller';

/**
 * Dos controllers sobre el mismo service, como en el resto del rework:
 *
 * - `NegocioConfigController`, sobre /config, es lo público y lo viejo. Ahí
 *   vive `GET /config/horario/abierto`, que consumen el menú y el POS: NO se
 *   cambia de forma.
 * - `AdminHorarioController` cuelga de /admin/horario y es solo la pantalla de
 *   Ajustes: las 7 filas del horario y el cierre manual, ADMIN en todo.
 * - `AdminConfigNegocioController`, sobre /admin/config-negocio, es la pestaña
 *   Configuración: las tres claves del negocio con nombres fijos en el código
 *   y un DTO por valor, en vez del upsert ciego del endpoint genérico.
 */
@Module({
  providers: [NegocioConfigService],
  controllers: [
    NegocioConfigController,
    AdminHorarioController,
    AdminConfigNegocioController,
  ],
  exports: [NegocioConfigService],
})
export class NegocioConfigModule {}
