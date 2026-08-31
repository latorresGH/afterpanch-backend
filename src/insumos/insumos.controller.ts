import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../auth/roles.decorator';
import { CreateInsumoDto } from './dto/create-insumo.dto';
import { DescontarStockDto } from './dto/descontar-stock.dto';
import { MovimientosQueryDto } from './dto/movimientos-query.dto';
import { SumarStockDto } from './dto/sumar-stock.dto';
import { ToggleActivoDto } from './dto/toggle-activo.dto';
import { UpdateInsumoDto } from './dto/update-insumo.dto';
import { InsumosService } from './insumos.service';

@ApiTags('Insumos')
@ApiBearerAuth()
@Controller('insumos')
export class InsumosController {
  constructor(private readonly insumosService: InsumosService) {}

  /**
   * Alta de insumo.
   *
   * Antes entraba como `@Body() body: { ... }` sin DTO, así que el
   * ValidationPipe no tenía nada que validar: un `stockInicial: "mucho"` o un
   * `proveedorId` inexistente llegaban derecho al service. Ahora valida contra
   * `CreateInsumoDto`, que además exige `stockMinimo` (ver la nota del DTO).
   */
  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Crear insumo',
    description:
      'Crea un insumo para control de stock. `stockMinimo` es obligatorio: ' +
      'ya no hay umbral global del que heredar.',
  })
  crear(@Body() dto: CreateInsumoDto) {
    return this.insumosService.crear(dto);
  }

  /**
   * Listado de insumos con su stock.
   *
   * Era @Public(): cualquiera sin login se bajaba el stock real de todo el
   * depósito. Misma clase de fuga que la de GET /productos, y se cierra igual.
   * Queda con los dos roles que lo consumen de verdad: ADMIN (panel de Stock,
   * Proveedores y Productos) y TRABAJADOR (el POS, para los badges de stock).
   *
   * La versión paginada, filtrada y con agregados de la pantalla del panel es
   * `GET /admin/insumos`. Esta se mantiene porque el POS y el editor de
   * recetas la usan como catálogo completo, que es exactamente lo que quieren.
   */
  @Get()
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  @ApiOperation({
    summary: 'Listar insumos',
    description:
      'Obtiene todos los insumos con su stock actual. Requiere sesión: el stock del depósito no es información pública.',
  })
  obtenerTodo(@Query('incluirInactivos') incluirInactivos?: string) {
    return this.insumosService.obtenerTodo(incluirInactivos === 'true');
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Actualizar insumo',
    description:
      'Si viene `stockActual`, la corrección queda registrada en el ' +
      'historial de movimientos como AJUSTE_MANUAL.',
  })
  actualizar(
    @Param('id') id: string,
    @Body() dto: UpdateInsumoDto,
    @Request() req: any,
  ) {
    return this.insumosService.actualizar(id, dto, req.user?.sub);
  }

  @Patch(':id/sumar')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  @ApiOperation({
    summary: 'Sumar stock al insumo',
    description: 'Incrementa el stock del insumo.',
  })
  sumarStock(
    @Param('id') id: string,
    @Body() dto: SumarStockDto,
    @Request() req: any,
  ) {
    return this.insumosService.sumarStock(
      id,
      dto.cantidad,
      dto.motivo,
      req.user?.sub,
    );
  }

  @Patch(':id/restar')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Descontar stock',
    description: 'Decrementa stock validando que no quede negativo.',
  })
  descontarStock(
    @Param('id') id: string,
    @Body() dto: DescontarStockDto,
    @Request() req: any,
  ) {
    return this.insumosService.descontarStock(
      id,
      dto.cantidad,
      undefined,
      dto.motivo,
      req.user?.sub,
    );
  }

  @Get(':id/movimientos')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  @ApiOperation({
    summary: 'Historial de movimientos de stock',
    description:
      'Movimientos crudos del insumo. `limit` está clampeado. La versión con ' +
      'la ficha del insumo y el pedido resuelto es GET /admin/insumos/:id/movimientos.',
  })
  obtenerMovimientos(
    @Param('id') id: string,
    @Query() query: MovimientosQueryDto,
  ) {
    return this.insumosService.obtenerMovimientos(id, query.limit);
  }

  @Get('movimientos/recientes')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  @ApiOperation({ summary: 'Movimientos recientes de stock' })
  obtenerMovimientosRecientes(@Query() query: MovimientosQueryDto) {
    return this.insumosService.obtenerMovimientosRecientes(query.limit);
  }

  @Patch(':id/activo')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Cambiar estado activo del insumo' })
  setActivo(@Param('id') id: string, @Body() dto: ToggleActivoDto) {
    return this.insumosService.setActivo(id, dto.activo);
  }

  @Patch(':id/baja')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Dar de baja insumo (activo=false)' })
  baja(@Param('id') id: string) {
    return this.insumosService.setActivo(id, false);
  }

  @Patch(':id/alta')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Dar de alta insumo (activo=true)' })
  alta(@Param('id') id: string) {
    return this.insumosService.setActivo(id, true);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Eliminar insumo',
    description: 'Solo si no está en ninguna receta.',
  })
  borrar(@Param('id') id: string) {
    return this.insumosService.borrar(id);
  }

  /**
   * @deprecated usar `GET /admin/insumos/reporte-consumo`. Se mantiene porque
   * el panel que hay hoy en producción lo consume con esta forma exacta.
   */
  @Get('reporte/consumo')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  @ApiOperation({
    summary: 'Reporte de consumo de stock por período (forma vieja)',
    deprecated: true,
  })
  reporteConsumo(@Query('desde') desde: string, @Query('hasta') hasta: string) {
    return this.insumosService.reporteConsumo(desde, hasta);
  }
}
