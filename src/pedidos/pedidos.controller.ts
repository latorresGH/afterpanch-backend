import {
  Controller,
  Post,
  Body,
  Get,
  Patch,
  Param,
  UseGuards,
  Request,
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
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Crear un nuevo pedido',
    description:
      'Crea un pedido con productos, extras y aderezos. Descuenta automáticamente el stock de insumos y extras.',
  })
  @ApiResponse({ status: 201, description: 'Pedido creado exitosamente' })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o stock insuficiente',
  })
  @ApiResponse({ status: 429, description: 'Demasiadas solicitudes' })
  crear(@Body() dto: CreatePedidoDto, @Request() req: any) {
    console.log(`[PEDIDOS] Pedido creado desde menú público`);
    return this.pedidosService.crearPedido(dto);
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
  @ApiOperation({ summary: 'Obtener un pedido por ID' })
  findOne(@Param('id') id: string) {
    return this.pedidosService.findOne(id);
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
