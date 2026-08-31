import {
  Body,
  Controller,
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
import { AdminProveedoresService } from './admin-proveedores.service';
import { AdminProveedoresQueryDto } from './dto/admin-proveedores-query.dto';
import {
  CrearProveedorDto,
  EditarProveedorDto,
} from './dto/admin-proveedor.dto';

/**
 * La pantalla de Proveedores del panel, colgada de /admin igual que
 * /admin/productos, /admin/estadisticas y /admin/insumos.
 *
 * ADMIN en TODO, lectura incluida, y ahi se aparta de /admin/insumos (que es
 * ADMIN + TRABAJADOR). El motivo es el publico: el POS necesita el listado de
 * insumos para los badges de stock, pero no consume proveedores en ningun
 * lado, y la ficha de un proveedor es la agenda de contactos y las condiciones
 * de compra del negocio. Si en algun momento el POS necesita leerlos, se
 * agrega TRABAJADOR solo en los dos GET.
 *
 * No hay DELETE a proposito: en esta seccion "eliminar" es archivar. Ver
 * `AdminProveedoresService.archivar`.
 */
@ApiTags('Proveedores admin')
@ApiBearerAuth()
@Controller('admin/proveedores')
export class AdminProveedoresController {
  constructor(private readonly adminProveedores: AdminProveedoresService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Pantalla de Proveedores del panel admin',
    description:
      'Compone en una sola request todo lo que muestra la pantalla: las ' +
      'tarjetas del header (padron, cobertura del stock, a quien hay que ' +
      'llamar con el detalle de que encargarle), el ranking de quien trae ' +
      'mas, y la pagina de proveedores con sus datos de contacto, cuantos ' +
      'insumos le cuelgan, cuantos estan bajo minimo, cuanto habria que ' +
      'comprarle y su ultima reposicion. La busqueda por nombre, el filtro ' +
      'por estado, el orden y la paginacion los resuelve Postgres: no se ' +
      'trae el padron entero para filtrar en memoria. Por defecto lista ' +
      'SOLO ACTIVOS; con ?estado=ARCHIVADOS o ?incluirArchivados=true ' +
      'aparecen los dados de baja.',
  })
  @ApiResponse({ status: 200, description: 'Datos de la pantalla' })
  @ApiResponse({ status: 400, description: 'Parametros invalidos' })
  listar(@Query() query: AdminProveedoresQueryDto) {
    return this.adminProveedores.listar(query);
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Ficha de un proveedor',
    description:
      'Los datos de contacto, el resumen de su stock, TODOS sus insumos ' +
      'vinculados (pausados incluidos) con su estado derivado y su compra ' +
      'sugerida, el pedido sugerido ya armado (solo lo que esta bajo minimo, ' +
      'con cuanto comprar y el texto listo para copiar) y su ultima ' +
      'reposicion.',
  })
  @ApiResponse({ status: 200, description: 'Ficha del proveedor' })
  @ApiResponse({ status: 404, description: 'Proveedor no encontrado' })
  detalle(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminProveedores.detalle(id);
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Alta de proveedor' })
  @ApiResponse({ status: 201, description: 'Proveedor creado' })
  @ApiResponse({ status: 400, description: 'Datos invalidos' })
  @ApiResponse({
    status: 409,
    description: 'Ya existe un proveedor con ese nombre (activo o archivado)',
  })
  crear(@Body() dto: CrearProveedorDto) {
    return this.adminProveedores.crear(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Edicion de los datos de un proveedor',
    description:
      'Un campo vacio BORRA el dato; un campo ausente lo deja como estaba. ' +
      '`activo` no se toca por aca: para eso estan /archivar y /reactivar.',
  })
  @ApiResponse({ status: 200, description: 'Proveedor actualizado' })
  @ApiResponse({ status: 404, description: 'Proveedor no encontrado' })
  @ApiResponse({ status: 409, description: 'Nombre ya usado por otro' })
  editar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarProveedorDto,
  ) {
    return this.adminProveedores.editar(id, dto);
  }

  @Patch(':id/archivar')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Archivar (baja logica)',
    description:
      'Deja de ofrecerse para asignar y sale de las tarjetas del header. NO ' +
      'desasigna los insumos que ya lo tenian: el vinculo se conserva.',
  })
  @ApiResponse({ status: 200, description: 'Proveedor archivado' })
  @ApiResponse({ status: 404, description: 'Proveedor no encontrado' })
  archivar(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminProveedores.archivar(id);
  }

  @Patch(':id/reactivar')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Reactivar un proveedor archivado' })
  @ApiResponse({ status: 200, description: 'Proveedor reactivado' })
  @ApiResponse({ status: 404, description: 'Proveedor no encontrado' })
  reactivar(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminProveedores.reactivar(id);
  }
}
