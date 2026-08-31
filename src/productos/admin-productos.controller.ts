import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../auth/roles.decorator';
import { AdminProductosService } from './admin-productos.service';
import { AdminProductosQueryDto } from './dto/admin-productos-query.dto';

@ApiTags('Productos admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminProductosController {
  constructor(private readonly adminProductos: AdminProductosService) {}

  @Get('productos')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Pantalla de Productos del panel admin',
    description:
      'Compone en una sola request todo lo que muestra la pantalla: las ' +
      'cuatro tarjetas del header (total, disponibles, pausados y el mas/menos ' +
      'vendido), la pagina de productos con su categoria, su receta y sus ' +
      'ventas, las categorias para el filtro y la paginacion. La busqueda ' +
      '(nombre + descripcion), el filtro por categoria y estado, el orden ' +
      '(alfabetico, precio o mas/menos vendidos) y la paginacion los resuelve ' +
      'Postgres: no se trae el catalogo entero para filtrar en memoria. ' +
      'Las ventas son el historico completo salvo que se acote con ?dias=N.',
  })
  @ApiResponse({
    status: 200,
    description: 'Datos de la pantalla de Productos',
  })
  @ApiResponse({ status: 400, description: 'Parametros invalidos' })
  listar(@Query() query: AdminProductosQueryDto) {
    return this.adminProductos.listar(query);
  }
}
