import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../auth/roles.decorator';
import { AdminExtrasService } from './admin-extras.service';
import { AdminExtrasQueryDto } from './dto/admin-extras-query.dto';
import { MovimientosQueryDto } from '../insumos/dto/movimientos-query.dto';
import { CrearExtraDto, EditarExtraDto } from './dto/admin-extra.dto';
import { ToggleActivoDto } from './dto/toggle-activo.dto';

/**
 * La pantalla de Extras del panel, colgada de /admin igual que el resto del
 * rework.
 *
 * ADMIN en TODO, lectura incluida, y ahi se aparta de /admin/insumos (que es
 * ADMIN + TRABAJADOR). El motivo es el publico: el POS y la carta NO consumen
 * estos endpoints — siguen usando los de /extras, que quedan intactos
 * (`GET /extras`, `/extras/por-categoria-producto/:id` y
 * `/extras/por-categoria-con-stock/:id` son @Public() y los usa el menu). Lo
 * que se expone aca es la configuracion del negocio: costo, umbral de aviso,
 * consumo por categoria y facturacion.
 *
 * ⚠️ Esta clase NO toca la logica de descuento de stock. El consumo por
 * categoria se lee y se edita desde aca; quien lo aplica al vender sigue
 * siendo `PedidosService`, sin cambios.
 */
@ApiTags('Extras admin')
@ApiBearerAuth()
@Controller('admin/extras')
export class AdminExtrasController {
  constructor(private readonly adminExtras: AdminExtrasService) {}

  /**
   * OJO con el orden de los metodos: 'movimientos' de ':id/movimientos' tiene
   * dos segmentos y ':id' uno solo, asi que hoy no chocan. Si alguna vez
   * aparece otra ruta de un segmento, la literal tiene que ir primero.
   */
  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Pantalla de Extras del panel admin',
    description:
      'Compone en una sola request todo lo que muestra la pantalla: los ' +
      'conteos del header (por estado de stock, premium, globales, sin ' +
      'alcance y cuantos descuentan 1 por defecto por no tener el consumo ' +
      'cargado), la facturacion de extras del periodo con su share, y la ' +
      'pagina de extras con su estado derivado, su alcance y sus ventas. La ' +
      'busqueda, los filtros, el orden (incluido "mas pedidos", que ordena ' +
      'por un agregado sobre el JSONB de los pedidos) y la paginacion los ' +
      'resuelve Postgres.',
  })
  @ApiResponse({ status: 200, description: 'Datos de la pantalla' })
  @ApiResponse({ status: 400, description: 'Parametros invalidos' })
  listar(@Query() query: AdminExtrasQueryDto) {
    return this.adminExtras.listar(query);
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Ficha de un extra, con toda su configuracion editable',
    description:
      'Los datos base mas UNA FILA POR CATEGORIA ACTIVA con su precio y su ' +
      'consumo. Cada fila dice si el valor esta cargado o si sale de un ' +
      'default (`precioEnDefault` / `consumoEnDefault`), y `consumoFaltante` ' +
      'marca las categorias donde el extra SE OFRECE y sin embargo ' +
      'descuenta 1 a ciegas.',
  })
  @ApiResponse({ status: 200, description: 'Ficha del extra' })
  @ApiResponse({ status: 404, description: 'Extra no encontrado' })
  detalle(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminExtras.detalle(id);
  }

  @Get(':id/movimientos')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Historial de movimientos de stock de un extra',
    description:
      'Los movimientos con antes → despues, motivo, tipo y el pedido que los ' +
      'origino. `limit` esta clampeado y `total` dice cuantos hay en ' +
      'realidad. Si el extra descuenta de un insumo, sus movimientos se ' +
      'registran contra el insumo: la respuesta lo avisa en ' +
      '`descuentaDelInsumo` y la lista viene vacia.',
  })
  @ApiResponse({ status: 200, description: 'Historial del extra' })
  @ApiResponse({ status: 404, description: 'Extra no encontrado' })
  historial(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MovimientosQueryDto,
  ) {
    return this.adminExtras.historial(id, query.limit);
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Alta de extra',
    description:
      'Crea el extra y su configuracion (alcance, precio por categoria y ' +
      'consumo por categoria) en una sola transaccion. `stockMinimo` es ' +
      'obligatorio.',
  })
  @ApiResponse({ status: 201, description: 'Extra creado' })
  @ApiResponse({ status: 400, description: 'Datos invalidos' })
  @ApiResponse({
    status: 409,
    description: 'Ya existe un extra con ese nombre',
  })
  crear(@Body() dto: CrearExtraDto) {
    return this.adminExtras.crear(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Edicion de extra',
    description:
      'Los tres bloques de configuracion (`categoriaIds`, `precios`, ' +
      '`consumos`) son REEMPLAZO COMPLETO cuando vienen: `[]` borra todas las ' +
      'filas de ese bloque y omitir la clave las deja como estaban.',
  })
  @ApiResponse({ status: 200, description: 'Extra actualizado' })
  @ApiResponse({ status: 404, description: 'Extra no encontrado' })
  @ApiResponse({ status: 409, description: 'Nombre ya usado por otro' })
  editar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EditarExtraDto) {
    return this.adminExtras.editar(id, dto);
  }

  @Patch(':id/activo')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Pausar o reactivar un extra',
    description:
      'Pausado sale de la carta sin perder nada: conserva su configuracion, ' +
      'su stock y su historial.',
  })
  @ApiResponse({ status: 200, description: 'Estado cambiado' })
  @ApiResponse({ status: 404, description: 'Extra no encontrado' })
  setActivo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ToggleActivoDto,
  ) {
    return this.adminExtras.setActivo(id, dto.activo);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Borrar un extra',
    description:
      'Solo si NUNCA se vendio y no tiene movimientos de stock. Si ya se uso, ' +
      'devuelve 400 y hay que pausarlo: borrarlo dejaria los movimientos ' +
      'huerfanos y las estadisticas sin poder decir cual era. Mismo criterio ' +
      'que el borrado de Productos.',
  })
  @ApiResponse({ status: 200, description: 'Extra borrado' })
  @ApiResponse({ status: 400, description: 'Ya fue usado: pausalo' })
  @ApiResponse({ status: 404, description: 'Extra no encontrado' })
  eliminar(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminExtras.eliminar(id);
  }
}
