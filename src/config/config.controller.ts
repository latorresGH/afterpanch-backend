import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  CLAVES_CON_ENDPOINT_PROPIO,
  CLAVES_ELIMINADAS,
  NegocioConfigService,
} from './config.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { Public } from '../auth/public.decorator';

@ApiTags('Configuración')
@Controller('config')
export class NegocioConfigController {
  constructor(private configService: NegocioConfigService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Obtener toda la configuración' })
  obtenerTodas() {
    return this.configService.obtenerTodas();
  }

  @Get(':clave')
  @Public()
  @ApiOperation({ summary: 'Obtener valor de configuración por clave' })
  async obtener(@Param('clave') clave: string) {
    const valor = await this.configService.obtener(clave);
    return { clave, valor };
  }

  /**
   * Escritura genérica de una clave cualquiera. No tiene whitelist: acepta el
   * nombre que venga en la URL y hace un upsert. Es el mecanismo por el que
   * `stock_bajo_umbral` volvía a existir cada vez que alguien apretaba
   * "Guardar", después de que una migración la hubiera borrado.
   *
   * No se cambia su alcance acá (el panel viejo desplegado lo usa para alias,
   * WhatsApp y precio de delivery, que siguen pasando), pero SÍ se le prohíben
   * dos conjuntos de claves:
   *
   * - Las que tienen su propio endpoint con su propio DTO. Si
   *   `local_cerrado_forzado` pudiera escribirse por acá, el string "si"
   *   quedaría guardado como valor y el toggle se leería como apagado sin que
   *   nadie se entere.
   * - Las ELIMINADAS. `stock_bajo_umbral` la borró una migración cuando el
   *   umbral pasó a ser por insumo, y este endpoint la resucitaba en cada
   *   "Guardar" del panel viejo — la migración sola no alcanzó. Sin este
   *   guard, borrarla de nuevo tampoco alcanzaría.
   *
   * El 400 de una clave eliminada es intencional y visible: el botón "Guardar
   * umbral" del panel VIEJO va a fallar hasta que salga el frontend nuevo, que
   * ya no muestra ese input. Es preferible a que siga escribiendo en silencio
   * un valor que hace divergir al POS de `Insumo.stockMinimo`.
   */
  @Post(':clave')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Establecer valor de configuración' })
  establecer(
    @Param('clave') clave: string,
    @Body() body: { valor: string; descripcion?: string },
  ) {
    if (CLAVES_ELIMINADAS.has(clave)) {
      throw new BadRequestException(
        `La clave "${clave}" ya no existe: se eliminó del sistema y no se puede volver a crear`,
      );
    }

    if (CLAVES_CON_ENDPOINT_PROPIO.has(clave)) {
      throw new BadRequestException(
        `La clave "${clave}" tiene su propio endpoint y no se escribe por acá`,
      );
    }

    return this.configService.establecer(clave, body.valor, body.descripcion);
  }

  /**
   * Lo que consumen el menú público (hooks/useConfig.ts) y, por dentro, el
   * Home del admin. La ruta y el shape son los de siempre — `abierto`,
   * `horaApertura`, `horaCierre`, `horaActual` — pero ahora los resuelve el
   * horario POR DÍA más el cierre manual, no las dos claves globales:
   * `horaApertura`/`horaCierre` son el rango DE HOY. El resto de los campos
   * del `EstadoLocal` son aditivos.
   */
  @Get('horario/abierto')
  @Public()
  @ApiOperation({ summary: 'Verificar si el local está abierto' })
  estaAbierto() {
    return this.configService.estaAbierto();
  }
}
