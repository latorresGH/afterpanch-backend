import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
})
export class PedidosGateway implements OnGatewayInit {
  @WebSocketServer()
  server: Server;

  afterInit(server: Server) {
    console.log('[WebSocket] PedidosGateway initialized');
  }

  notificarNuevoPedido(pedido: {
    id: string;
    nombreCliente: string;
    apellidoCliente?: string;
    numeroCliente?: string;
    tipo: string;
    total: number;
  }) {
    this.server.emit('nuevo-pedido', {
      id: pedido.id,
      nombreCliente: pedido.nombreCliente,
      apellidoCliente: pedido.apellidoCliente || '',
      numeroCliente: pedido.numeroCliente || '',
      tipo: pedido.tipo,
      total: Number(pedido.total),
      timestamp: new Date().toISOString(),
    });
  }
}
