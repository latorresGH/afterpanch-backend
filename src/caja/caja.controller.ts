import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CajaService } from './caja.service';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import {
  ConfirmarPagoDto,
  MovimientoManualDto,
} from './dto/confirmar-pago.dto';

@ApiTags('Caja')
@ApiBearerAuth()
@Controller('caja')
@Roles(Role.ADMIN, Role.TRABAJADOR)
export class CajaController {
  constructor(private readonly cajaService: CajaService) {}

  @Post('pedido/:pedidoId/confirmar')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Confirmar pago de pedido (dinero recibido)',
    description:
      'Registra el pago de un pedido, separando ganancia del negocio y del repartidor. Solo ADMIN.',
  })
  @ApiResponse({ status: 201, description: 'Pago registrado exitosamente' })
  @ApiResponse({ status: 400, description: 'Pedido cancelado o ya registrado' })
  confirmarPago(
    @Param('pedidoId') pedidoId: string,
    @Body() dto: ConfirmarPagoDto,
  ) {
    return this.cajaService.registrarPagoPedido(
      pedidoId,
      dto.confirmadoPor,
      dto.gananciaRepartidor,
    );
  }

  @Post('movimiento')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Registrar movimiento manual de caja',
    description:
      'Permite registrar entradas, salidas o ajustes manuales. Solo ADMIN.',
  })
  registrarMovimientoManual(@Body() dto: MovimientoManualDto) {
    return this.cajaService.registrarMovimientoManual({
      tipo: dto.tipo,
      monto: dto.monto,
      descripcion: dto.descripcion,
      confirmadoPor: dto.confirmadoPor,
    });
  }

  @Get('resumen')
  @ApiOperation({
    summary: 'Obtener resumen de caja',
    description:
      'Devuelve el balance de caja con totales de entradas, salidas, ganancias negocio y repartidor.',
  })
  obtenerResumen(
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
  ) {
    const inicio = fechaInicio ? new Date(fechaInicio) : undefined;
    const fin = fechaFin ? new Date(fechaFin) : undefined;
    return this.cajaService.obtenerResumenCaja(inicio, fin);
  }

  @Get('pedido/:pedidoId')
  @ApiOperation({ summary: 'Obtener movimientos de un pedido específico' })
  obtenerMovimientosPorPedido(@Param('pedidoId') pedidoId: string) {
    return this.cajaService.obtenerMovimientosPorPedido(pedidoId);
  }
}
