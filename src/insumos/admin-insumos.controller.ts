import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../auth/roles.decorator';
import { AdminInsumosService } from './admin-insumos.service';
import { AdminInsumosQueryDto } from './dto/admin-insumos-query.dto';
import { MovimientosQueryDto } from './dto/movimientos-query.dto';
import { ReporteConsumoQueryDto } from './dto/reporte-consumo-query.dto';

/**
 * La pantalla de Insumos/Stock del panel, colgada de /admin igual que
 * /admin/productos y /admin/estadisticas.
 *
 * Los tres endpoints son de LECTURA. Las escrituras (alta, edicion, ajustes de
 * stock, baja) siguen en `InsumosController`, sobre /insumos: son operaciones
 * sobre la entidad, no sobre la pantalla.
 *
 * ADMIN + TRABAJADOR en los tres. El POS necesita el listado para los badges
 * de stock y el historial para explicar un descuento, y ninguno de los dos
 * expone nada que un TRABAJADOR no vea ya hoy por GET /insumos.
 */
@ApiTags('Insumos admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminInsumosController {
  constructor(private readonly adminInsumos: AdminInsumosService) {}

  /**
   * OJO con el orden de los metodos: 'insumos/reporte-consumo' tiene que
   * declararse ANTES que 'insumos/:id/movimientos'. Hoy no chocan porque
   * tienen distinta cantidad de segmentos, pero si alguna vez aparece un
   * 'insumos/:id' de un solo segmento, el que este primero gana.
   */
  @Get('insumos')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  @ApiOperation({
    summary: 'Pantalla de Insumos/Stock del panel admin',
    description:
      'Compone en una sola request todo lo que muestra la pantalla: las ' +
      'tarjetas del header (conteo por estado, compra sugerida total, ' +
      'insumos sin proveedor, consumo del periodo), la pagina de insumos con ' +
      'su proveedor, su estado derivado (OK / BAJO / SIN_STOCK / PAUSADO), su ' +
      'compra sugerida y su consumo, el bloque de los que se agotan primero, ' +
      'los proveedores para el selector y la paginacion. La busqueda por ' +
      'nombre, los filtros (estado de stock, alta/baja, proveedor), el orden ' +
      'y la paginacion los resuelve Postgres: no se trae el deposito entero ' +
      'para filtrar en memoria. El estado y la compra sugerida se calculan ' +
      'contra el stockMinimo DEL INSUMO, no contra un umbral global.',
  })
  @ApiResponse({ status: 200, description: 'Datos de la pantalla de Insumos' })
  @ApiResponse({ status: 400, description: 'Parametros invalidos' })
  listar(@Query() query: AdminInsumosQueryDto) {
    return this.adminInsumos.listar(query);
  }

  @Get('insumos/reporte-consumo')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  @ApiOperation({
    summary: 'Reporte de consumo de insumos por rango',
    description:
      'Cuanto se consumio de cada insumo en el periodo, con su serie diaria ' +
      'y su porcentaje sobre el consumo total. El consumo es NETO: los ' +
      'descuentos por pedido menos las reposiciones por cancelacion. Los ' +
      'ajustes manuales quedan afuera (comprar no es consumir). El rango se ' +
      'pide con ?dias=N (ventana que termina hoy, por defecto 7) o con ' +
      '?desde=YYYY-MM-DD&hasta=YYYY-MM-DD, que tiene prioridad.',
  })
  @ApiResponse({ status: 200, description: 'Reporte de consumo' })
  @ApiResponse({ status: 400, description: 'Rango invalido' })
  reporteConsumo(@Query() query: ReporteConsumoQueryDto) {
    return this.adminInsumos.reporteConsumo(query);
  }

  @Get('insumos/:id/movimientos')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  @ApiOperation({
    summary: 'Historial de movimientos de un insumo',
    description:
      'La ficha del insumo (stock, minimo, compra sugerida, estado) mas sus ' +
      'movimientos con antes → despues, motivo, tipo y el pedido que los ' +
      'origino. Incluye las REPOSICION que escribe la cancelacion de un ' +
      'pedido. `limit` esta clampeado; `total` dice cuantos movimientos hay ' +
      'en realidad, para saber si el limite recorto.',
  })
  @ApiResponse({ status: 200, description: 'Historial del insumo' })
  @ApiResponse({ status: 404, description: 'Insumo no encontrado' })
  historial(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MovimientosQueryDto,
  ) {
    return this.adminInsumos.historial(id, query.limit);
  }
}
