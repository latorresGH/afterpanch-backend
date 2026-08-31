import { Controller, Get, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { HomeService } from './home.service';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Home admin')
@ApiBearerAuth()
@Controller('admin')
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  @Get('home')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Datos del Home del panel admin',
    description:
      'Compone en una sola request todo lo que muestra el Home: bienvenida, ' +
      'estado del local, caja de hoy, pedidos abiertos, delivery pendiente de ' +
      'confirmar, equipo con presencia, facturacion de la semana, ' +
      'movimientos del dia y los avisos de cola/stock/oferta. Todos los ' +
      'totales vienen ya calculados.',
  })
  @ApiResponse({ status: 200, description: 'Datos del Home' })
  getHome(@Request() req: any) {
    return this.homeService.getHome(req.user.sub);
  }
}
