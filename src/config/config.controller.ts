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
}
