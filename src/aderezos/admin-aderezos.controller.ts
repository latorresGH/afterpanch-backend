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
import { AdminAderezosService } from './admin-aderezos.service';
import { AdminAderezosQueryDto } from './dto/admin-aderezos-query.dto';
import { MovimientosQueryDto } from '../insumos/dto/movimientos-query.dto';
import { CrearAderezoDto, EditarAderezoDto } from './dto/admin-aderezo.dto';
import { ToggleActivoAderezoDto } from './dto/toggle-activo.dto';

/**
 * La pantalla de Salsas/Aderezos del panel, colgada de /admin igual que el
 * resto del rework.
 *
 * ADMIN en TODO, lectura incluida, igual que /admin/extras y a diferencia de
 * /admin/insumos (que es ADMIN + TRABAJADOR). El motivo es el publico: el POS
 * y la carta NO consumen estos endpoints — siguen usando los de /aderezos, que
 * quedan intactos (`GET /aderezos`, `/aderezos/por-categoria-producto/:id` y
 * `/aderezos/por-categoria-con-stock/:id` son @Public() y los usan el menu y
 * el POS a traves de `useAderezos`). Lo que se expone aca es la configuracion
 * del negocio: umbral de aviso, unidad, alcance y consumo por categoria.
 *
 * ⚠️ NO HAY PRECIO EN NINGUN ENDPOINT DE ESTA CLASE. Las salsas son siempre
 * gratis; "AderezoPrecio" esta vacia y marcada para deprecar.
 *
 * ⚠️ EL AJUSTE RAPIDO DE STOCK NO VIVE ACA. Sumar y descontar siguen en
 * `PATCH /aderezos/:id/sumar` y `PATCH /aderezos/:id/descontar` (mismo lugar
 * que en Insumos, donde el admin controller tambien es solo de lectura para
 * eso). Son los que tiene que usar el front nuevo: hacen increment/decrement
 * ATOMICO y escriben el movimiento. El `PATCH /admin/aderezos/:id` con
 * `stockActual` absoluto sirve para corregir un recuento desde la ficha, pero
 * lee-calcula-escribe y dos ajustes simultaneos se pisan.
 *
 * ⚠️ Esta clase NO toca la logica de descuento de stock. El consumo por
 * categoria se lee y se edita desde aca; quien lo aplica al vender sigue
 * siendo `PedidosService.getAderezoConsumo`, sin cambios.
 */
@ApiTags('Aderezos admin')
@ApiBearerAuth()
@Controller('admin/aderezos')
export class AdminAderezosController {
  constructor(private readonly adminAderezos: AdminAderezosService) {}

  /**
   * OJO con el orden de los metodos: 'movimientos' de ':id/movimientos' tiene
   * dos segmentos y ':id' uno solo, asi que hoy no chocan. Si alguna vez
   * aparece otra ruta de un segmento, la literal tiene que ir primero.
   */
  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Pantalla de Salsas del panel admin',
    description:
      'Compone en una sola request todo lo que muestra la pantalla: la salud ' +
      'del stock del header (conteos por estado y % con stock suficiente), el ' +
      'consumo del periodo, el bloque "reponer primero" (las que menos ' +
      'aguantan al ritmo de la ventana) y la pagina de salsas con su estado ' +
      'derivado, su alcance y su consumo diario. La busqueda, los filtros, el ' +
      'orden (incluido "aguante", que ordena por un agregado sobre el ledger ' +
      'de movimientos) y la paginacion los resuelve Postgres.',
  })
  @ApiResponse({ status: 200, description: 'Datos de la pantalla' })
  @ApiResponse({ status: 400, description: 'Parametros invalidos' })
  listar(@Query() query: AdminAderezosQueryDto) {
    return this.adminAderezos.listar(query);
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Ficha de una salsa, con toda su configuracion editable',
    description:
      'Los datos base mas UNA FILA POR CATEGORIA con su consumo. Cada fila ' +
      'dice si el valor esta cargado o si sale del default de 1 ' +
      '(`consumoEnDefault`), y `consumoFaltante` marca las categorias donde ' +
      'la salsa SE OFRECE y sin embargo descuenta 1 a ciegas. Sin precio: las ' +
      'salsas son siempre gratis.',
  })
  @ApiResponse({ status: 200, description: 'Ficha de la salsa' })
  @ApiResponse({ status: 404, description: 'Aderezo no encontrado' })
  detalle(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminAderezos.detalle(id);
  }

  @Get(':id/movimientos')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Historial de movimientos de stock de una salsa',
    description:
      'Los movimientos con antes → despues, motivo, tipo y el pedido que los ' +
      'origino. `limit` esta CLAMPEADO (1..200, 50 por defecto) y `total` ' +
      'dice cuantos hay en realidad — el endpoint viejo ' +
      '(`/aderezos/:id/movimientos`) no tenia techo.',
  })
  @ApiResponse({ status: 200, description: 'Historial de la salsa' })
  @ApiResponse({ status: 404, description: 'Aderezo no encontrado' })
  historial(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MovimientosQueryDto,
  ) {
    return this.adminAderezos.historial(id, query.limit);
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Alta de salsa',
    description:
      'Crea la salsa y su configuracion (alcance y consumo por categoria) en ' +
      'una sola transaccion. `stockMinimo` y `unidadMedida` son obligatorios; ' +
      '`stockActual` arranca en 0 si no viene (antes caia a 999).',
  })
  @ApiResponse({ status: 201, description: 'Salsa creada' })
  @ApiResponse({ status: 400, description: 'Datos invalidos' })
  @ApiResponse({
    status: 409,
    description: 'Ya existe una salsa con ese nombre',
  })
  crear(@Body() dto: CrearAderezoDto) {
    return this.adminAderezos.crear(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Edicion de salsa',
    description:
      'Los dos bloques de configuracion (`categoriaIds`, `consumos`) son ' +
      'REEMPLAZO COMPLETO cuando vienen: `[]` borra todas las filas de ese ' +
      'bloque y omitir la clave las deja como estaban. Un `stockActual` ' +
      'distinto al actual deja su movimiento de auditoria.',
  })
  @ApiResponse({ status: 200, description: 'Salsa actualizada' })
  @ApiResponse({ status: 404, description: 'Aderezo no encontrado' })
  @ApiResponse({ status: 409, description: 'Nombre ya usado por otra' })
  editar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarAderezoDto,
  ) {
    return this.adminAderezos.editar(id, dto);
  }

  @Patch(':id/activo')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Pausar o reactivar una salsa',
    description:
      'Pausada sale de la carta sin perder nada: conserva su configuracion, ' +
      'su stock y su historial. Es lo que hay que hacer con una salsa que ya ' +
      'se uso en pedidos y por lo tanto no se puede borrar.',
  })
  @ApiResponse({ status: 200, description: 'Estado cambiado' })
  @ApiResponse({ status: 404, description: 'Aderezo no encontrado' })
  setActivo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ToggleActivoAderezoDto,
  ) {
    return this.adminAderezos.setActivo(id, dto.activo);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Borrar una salsa',
    description:
      'Solo si NUNCA se uso en un pedido. Si ya se uso, devuelve 400 y hay ' +
      'que pausarla. Mismo criterio que Productos y Extras, pero aca el guard ' +
      'ademas evita una PERDIDA SILENCIOSA: la relacion con PedidoDetalle es ' +
      'many-to-many con ON DELETE CASCADE, asi que sin el chequeo el borrado ' +
      'no falla, se lleva puesto que esos pedidos llevaban esta salsa.',
  })
  @ApiResponse({ status: 200, description: 'Salsa borrada' })
  @ApiResponse({ status: 400, description: 'Ya fue usada: pausala' })
  @ApiResponse({ status: 404, description: 'Aderezo no encontrado' })
  eliminar(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminAderezos.eliminar(id);
  }
}
