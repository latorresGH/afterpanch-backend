import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ActorCaja, CajaService } from './caja.service';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import {
  ConfirmarPagoDto,
  MovimientoManualDto,
} from './dto/confirmar-pago.dto';
import { ConfirmarLoteDto } from './dto/confirmar-lote.dto';

/**
 * Quien esta escribiendo en la caja, sacado del JWT y de ningun otro lado.
 *
 * `req.user` lo arma JwtStrategy.validate, que ademas ya verifico contra la
 * base que el usuario exista y este activo. Un `confirmadoPor` que venga del
 * body se ignora por completo (de hecho el ValidationPipe lo rechaza con 400,
 * porque ningun DTO de caja lo declara).
 */
function actorDe(req: any): ActorCaja {
  return { id: req.user.sub, nombre: req.user.nombre };
}

@ApiTags('Caja')
@ApiBearerAuth()
@Controller('caja')
@Roles(Role.ADMIN, Role.TRABAJADOR)
export class CajaController {
  constructor(private readonly cajaService: CajaService) {}

  @Post('pedido/:pedidoId/confirmar')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  @ApiOperation({
    summary: 'Confirmar pago de pedido (dinero recibido)',
    description:
      'Registra el pago de un pedido, separando ganancia del negocio y del ' +
      'repartidor. Es idempotente: si el pedido ya estaba cobrado devuelve el ' +
      'movimiento existente con `yaExistia: true`, no un error. ' +
      'Quien registra sale del JWT.',
  })
  @ApiResponse({ status: 201, description: 'Pago registrado (o ya estaba)' })
  @ApiResponse({ status: 400, description: 'Pedido cancelado' })
  @ApiResponse({ status: 404, description: 'Pedido no encontrado' })
  confirmarPago(
    @Param('pedidoId') pedidoId: string,
    @Body() dto: ConfirmarPagoDto,
    @Request() req: any,
  ) {
    return this.cajaService.registrarPagoPedido(
      pedidoId,
      actorDe(req),
      dto.gananciaRepartidor,
    );
  }

  @Post('confirmar-lote')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  @ApiOperation({
    summary: 'Confirmar el cobro de varios pedidos',
    description:
      'Confirma en lote (máx 50). Cada pedido va en su propia transacción: ' +
      'devuelve éxito parcial con los que fallaron y por qué, en vez de ' +
      'abortar todo. Los que ya estaban cobrados salen en `yaConfirmados` y ' +
      'NO suman a `totalConfirmado`. Quien registra sale del JWT, no del body.',
  })
  @ApiResponse({ status: 201, description: 'Lote procesado (puede tener fallidos)' })
  confirmarLote(@Body() dto: ConfirmarLoteDto, @Request() req: any) {
    return this.cajaService.confirmarLote(dto.pedidoIds, actorDe(req));
  }

  @Post('movimiento')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  @ApiOperation({
    summary: 'Registrar movimiento manual de caja',
    description:
      'Permite registrar entradas, salidas o ajustes manuales. ENTRADA y ' +
      'SALIDA van con monto positivo; solo AJUSTE admite negativo. Quien ' +
      'registra sale del JWT.',
  })
  registrarMovimientoManual(
    @Body() dto: MovimientoManualDto,
    @Request() req: any,
  ) {
    return this.cajaService.registrarMovimientoManual({
      tipo: dto.tipo,
      monto: dto.monto,
      descripcion: dto.descripcion,
      actor: actorDe(req),
    });
  }

  @Get('resumen')
  @ApiOperation({
    summary: 'Obtener resumen de caja',
    description:
      'Devuelve el balance de caja con totales de entradas, salidas, ganancias ' +
      'negocio y repartidor. Los totales salen de la misma función que usa el ' +
      'Home, así que para el mismo rango dan exactamente los mismos números.',
  })
  obtenerResumen(
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
  ) {
    const inicio = fechaInicio ? new Date(fechaInicio) : undefined;
    const fin = fechaFin ? new Date(fechaFin) : undefined;
    return this.cajaService.obtenerResumenCaja(inicio, fin);
  }

  @Get('historial')
  @ApiOperation({
    summary: 'Historial de movimientos paginado',
    description:
      'Devuelve movimientos de caja paginados. Exclusivo para el panel admin. No afecta /caja/resumen.',
  })
  getHistorial(
    @Query('pagina') pagina?: string,
    @Query('limit') limit?: string,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
  ) {
    const p = Math.max(1, parseInt(pagina ?? '1', 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit ?? '20', 10) || 20));
    const inicio = fechaInicio ? new Date(fechaInicio) : undefined;
    const fin = fechaFin ? new Date(fechaFin) : undefined;
    return this.cajaService.getHistorialPaginado(p, l, inicio, fin);
  }

  @Get('pedido/:pedidoId')
  @ApiOperation({ summary: 'Obtener movimientos de un pedido específico' })
  obtenerMovimientosPorPedido(@Param('pedidoId') pedidoId: string) {
    return this.cajaService.obtenerMovimientosPorPedido(pedidoId);
  }
}
