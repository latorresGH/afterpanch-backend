import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NegocioConfigService } from './config.service';
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

  @Post(':clave')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Establecer valor de configuración' })
  establecer(
    @Param('clave') clave: string,
    @Body() body: { valor: string; descripcion?: string },
  ) {
    return this.configService.establecer(clave, body.valor, body.descripcion);
  }

  @Get('horario/abierto')
  @Public()
  @ApiOperation({ summary: 'Verificar si el local está abierto' })
  async estaAbierto() {
    const horaAperturaStr = await this.configService.obtener('hora_apertura');
    const horaCierreStr = await this.configService.obtener('hora_cierre');

    console.log('🕐 Hora apertura config:', horaAperturaStr);
    console.log('🕐 Hora cierre config:', horaCierreStr);

    if (!horaAperturaStr || !horaCierreStr) {
      return { abierto: true, horaApertura: null, horaCierre: null };
    }

    const ahora = new Date();
    console.log('🕐 Fecha UTC:', ahora.toISOString());
    console.log('🕐 Fecha local servidor:', ahora.toString());

    const opciones: Intl.DateTimeFormatOptions = {
      timeZone: 'America/Argentina/Mendoza',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    };
    const horaActualStr = ahora.toLocaleTimeString('es-AR', opciones);
    console.log('🕐 Hora actual Argentina (string):', horaActualStr);

    const [horaActualHoras, horaActualMinutos] = horaActualStr.split(':').map(Number);
    const horaActual = horaActualHoras * 60 + horaActualMinutos;
    console.log('🕐 Hora actual (minutos desde medianoche):', horaActual);

    const [horaAp, minAp] = horaAperturaStr.split(':').map(Number);
    const [horaCi, minCi] = horaCierreStr.split(':').map(Number);
    const horaApertura = horaAp * 60 + (minAp || 0);
    const horaCierre = horaCi * 60 + (minCi || 0);

    console.log('🕐 Hora apertura (minutos):', horaApertura);
    console.log('🕐 Hora cierre (minutos):', horaCierre);

    const abierto = horaActual >= horaApertura && horaActual < horaCierre;
    console.log('🕐 ¿Abierto?:', abierto, `(${horaActual} >= ${horaApertura} && ${horaActual} < ${horaCierre})`);

    return {
      abierto,
      horaApertura: horaAperturaStr,
      horaCierre: horaCierreStr,
      horaActual: horaActualStr,
    };
  }
}
