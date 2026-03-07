import { Controller, Post, Body, Get, Patch, Param } from "@nestjs/common";
import { PedidosService } from "./pedidos.service";
import { CancelarPedidoDto } from "./dto/cancelar-pedido.dto";
import { CambiarEstadoDto } from "./dto/cambiar-estado.dto";
import { CreatePedidoDto } from "./dto/create-pedido.dto";
import { SetMetodoPagoDto } from "./dto/set-metodo-pago.dto";

@Controller("pedidos")
export class PedidosController {
  constructor(private readonly pedidosService: PedidosService) {}

  @Post()
  crear(@Body() dto: CreatePedidoDto) {
    return this.pedidosService.crearPedido(dto);
  }

  @Get()
  listarTodos() {
    return this.pedidosService.listarTodos();
  }

  @Get("delivery-pendientes")
  listarDeliveryPendientes() {
    return this.pedidosService.listarDeliveryPendientes();
  }

  @Patch(":id/estado")
  cambiarEstado(@Param("id") id: string, @Body() body: CambiarEstadoDto) {
    return this.pedidosService.cambiarEstado(id, body.estado);
  }

  @Patch(":id/finalizar")
  finalizar(@Param("id") id: string) {
    return this.pedidosService.finalizarPedido(id);
  }

  @Post(":id/cancelar")
  cancelar(@Param("id") id: string, @Body() body: CancelarPedidoDto) {
    return this.pedidosService.cancelarPedido(id, body.motivo, body.rol);
  }

  @Patch(":id/pago")
  setPago(@Param("id") id: string, @Body() dto: SetMetodoPagoDto) {
    return this.pedidosService.setPago(id, dto);
  }
}