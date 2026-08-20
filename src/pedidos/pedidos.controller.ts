import {
  Controller,
  Post,
  Body,
  Get,
  Patch,
  Param,
  Query,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PedidosService } from './pedidos.service';
import { CancelarPedidoDto } from './dto/cancelar-pedido.dto';
import { CambiarEstadoDto } from './dto/cambiar-estado.dto';
import { CreatePedidoDto } from './dto/create-pedido.dto';
import { SetMetodoPagoDto } from './dto/set-metodo-pago.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { Roles, ROLES_KEY } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { Public } from '../auth/public.decorator';

@ApiTags('Pedidos')
@ApiBearerAuth()
@Controller('pedidos')
export class PedidosController {
  constructor(private readonly pedidosService: PedidosService) {}

  @Post()
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Crear un nuevo pedido',
    description:
      'Crea un pedido con productos, extras y aderezos. Descuenta automáticamente el stock de insumos y extras. ' +
      'Accesible sin autenticación (menú público); si llega un JWT de ADMIN/TRABAJADOR se respeta el costoEnvio manual.',
  })
  @ApiResponse({ status: 201, description: 'Pedido creado exitosamente' })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o stock insuficiente',
  })
  @ApiResponse({ status: 429, description: 'Demasiadas solicitudes' })
  crear(@Body() dto: CreatePedidoDto, @Request() req: any) {
    const actor = req.user ?? null;
    console.log(
      `[PEDIDOS] Pedido creado ${actor ? `por ${actor.role} (${actor.email})` : 'desde menú público (anónimo)'}`,
    );
    return this.pedidosService.crearPedido(dto, actor);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar todos los pedidos',
    description:
      'Obtiene todos los pedidos con sus detalles, aderezos y movimientos de caja.',
  })
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  listarTodos() {
    return this.pedidosService.listarTodos();
  }

  @Get('demora-actual')
  @Public()
  @ApiOperation({ summary: 'Obtener la demora actual calculada' })
  getDemoraActual() {
    return this.pedidosService.getDemoraActual();
  }

  @Post('demora-modo')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  @ApiOperation({ summary: 'Configurar el modo de demora (AUTO o MANUAL)' })
  async setDemoraManual(@Body() body: { modo: 'AUTO' | 'MANUAL'; minutos?: number }) {
    const { modo, minutos } = body;
    const MINUTOS_VALIDOS = [0, 5, 10, 15, 20, 30, 45, 60];
    if (modo === 'MANUAL') {
      if (minutos === undefined || !MINUTOS_VALIDOS.includes(minutos)) {
        throw new BadRequestException(
          `minutos debe ser uno de: ${MINUTOS_VALIDOS.join(', ')}`,
        );
      }
    }
    return this.pedidosService.setDemoraManual({ modo, minutos });
  }

  // ⚠️ Va ANTES de @Get(':id'): Nest resuelve las rutas en orden de
  // declaración, así que si quedara después, 'activos' entraría como :id.
  @Get('activos')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  @ApiOperation({
    summary: 'Listar pedidos activos (monitor del POS)',
    description:
      'Pedidos que todavía se están trabajando (todos menos ENTREGADO y ' +
      'CANCELADO), con solo los campos que el monitor renderiza. Payload ' +
      'acotado: no crece con el histórico, a diferencia de GET /pedidos.',
  })
  listarActivos() {
    return this.pedidosService.listarActivos();
  }

  @Get('delivery-pendientes')
  @ApiOperation({
    summary: 'Listar pedidos de delivery pendientes',
    description:
      'Obtiene pedidos de tipo DELIVERY que están pendientes de entrega.',
  })
  @Roles(Role.ADMIN, Role.DELIVERY)
  listarDeliveryPendientes() {
    return this.pedidosService.listarDeliveryPendientes();
  }

  @Get(':id')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Obtener un pedido por ID',
    description:
      'Público solo con el trackingCode del pedido (?code=). Empleados autenticados ' +
      '(ADMIN/TRABAJADOR) no necesitan el código.',
  })
  findOne(
    @Param('id') id: string,
    @Query('code') code: string,
    @Request() req: any,
  ) {
    const actor = req.user ?? null;
    const esEmpleado =
      actor?.role === Role.ADMIN || actor?.role === Role.TRABAJADOR;
    return this.pedidosService.findOne(id, code, esEmpleado);
  }

  @Patch(':id/estado')
  @ApiOperation({
    summary: 'Cambiar estado de un pedido',
    description:
      'Cambia el estado del pedido (PENDIENTE, EN_CAMINO, ENTREGADO).',
  })
  @Roles(Role.ADMIN, Role.TRABAJADOR, Role.DELIVERY)
  cambiarEstado(@Param('id') id: string, @Body() body: CambiarEstadoDto) {
    return this.pedidosService.cambiarEstado(id, body.estado);
  }

  @Patch(':id/finalizar')
  @ApiOperation({
    summary: 'Finalizar pedido',
    description: 'Marca el pedido como ENTREGADO.',
  })
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  finalizar(@Param('id') id: string) {
    return this.pedidosService.finalizarPedido(id);
  }

  @Post(':id/cancelar')
  @ApiOperation({
    summary: 'Cancelar pedido',
    description:
      'Cancela un pedido y restaura el stock de insumos y extras descontados.',
  })
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  cancelar(@Param('id') id: string, @Body() body: CancelarPedidoDto) {
    return this.pedidosService.cancelarPedido(id, body.motivo, body.rol);
  }

  @Patch(':id/pago')
  @ApiOperation({ summary: 'Actualizar método de pago' })
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  setPago(@Param('id') id: string, @Body() dto: SetMetodoPagoDto) {
    return this.pedidosService.setPago(id, dto);
  }

  @Patch(':id/costo-envio')
  @ApiOperation({
    summary: 'Actualizar costo de envío',
    description:
      'Actualiza el costo de envío de un pedido DELIVERY. Solo para pedidos pendientes.',
  })
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  setCostoEnvio(@Param('id') id: string, @Body() body: { costoEnvio: number }) {
    return this.pedidosService.setCostoEnvio(id, body.costoEnvio);
  }

  @Patch(':id/asignar')
  @ApiOperation({
    summary: 'Asignar repartidor y/o costo de envío',
    description:
      'Asigna un repartidor y/o actualiza el costo de envío de un pedido.',
  })
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  asignarRepartidor(
    @Param('id') id: string,
    @Body() body: { repartidorId?: string; costoEnvio?: number },
  ) {
    return this.pedidosService.asignarRepartidor(id, body);
  }
}
