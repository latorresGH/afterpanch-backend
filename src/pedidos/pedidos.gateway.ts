import { Injectable } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { JwtStrategy } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { tieneAccesoTracking } from './tracking.util';

const ROOM_STAFF = 'staff';
const roomPedido = (id: string) => `pedido:${id}`;

@Injectable()
@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
})
export class PedidosGateway implements OnGatewayInit {
  @WebSocketServer()
  server: Server;

  constructor(
    private jwtService: JwtService,
    private jwtStrategy: JwtStrategy,
    private prisma: PrismaService,
  ) {}

  afterInit(server: Server) {
    console.log('[WebSocket] PedidosGateway initialized');
  }

  /**
   * Un socket de staff (campanita admin/POS) debe unirse explícitamente a
   * esta room mandando su JWT. Reutiliza JwtStrategy.validate (mismo chequeo
   * de usuario existente + activo que ya protege las rutas HTTP) para no
   * duplicar esa lógica acá.
   */
  @SubscribeMessage('join-staff')
  async handleJoinStaff(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { token?: string },
  ) {
    if (!body?.token) {
      client.emit('join-error', { room: ROOM_STAFF, message: 'Token requerido' });
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync(body.token);
      const user = await this.jwtStrategy.validate(payload);
      if (user.role !== Role.ADMIN && user.role !== Role.TRABAJADOR) {
        client.emit('join-error', { room: ROOM_STAFF, message: 'Rol no autorizado' });
        return;
      }
      client.join(ROOM_STAFF);
    } catch {
      client.emit('join-error', { room: ROOM_STAFF, message: 'Token inválido' });
    }
  }

  /**
   * Un socket de la página pública de seguimiento se une a la room de UN
   * pedido mandando el mismo `id`/`code` que ya exige GET /pedidos/:id (ver
   * PedidosService.verificarTrackingAcceso / tracking.util.ts).
   */
  @SubscribeMessage('join-pedido')
  async handleJoinPedido(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { id?: string; code?: string },
  ) {
    if (!body?.id) {
      client.emit('join-error', { room: 'pedido', message: 'id requerido' });
      return;
    }

    const pedido = await this.prisma.pedido.findUnique({
      where: { id: body.id },
      select: { trackingCode: true },
    });

    if (!pedido || !tieneAccesoTracking(pedido.trackingCode, body.code)) {
      client.emit('join-error', { room: 'pedido', message: 'Acceso denegado' });
      return;
    }

    client.join(roomPedido(body.id));
  }

  notificarNuevoPedido(pedido: {
    id: string;
    nombreCliente: string;
    apellidoCliente?: string;
    numeroCliente?: string;
    tipo: string;
    total: number;
  }) {
    this.server.to(ROOM_STAFF).emit('nuevo-pedido', {
      id: pedido.id,
      nombreCliente: pedido.nombreCliente,
      apellidoCliente: pedido.apellidoCliente || '',
      numeroCliente: pedido.numeroCliente || '',
      tipo: pedido.tipo,
      total: Number(pedido.total),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Cambios en vivo de UN pedido (estado, repartidor, costoEnvio) — solo
   * llegan a quien se unió a `pedido:${pedidoId}` con el trackingCode
   * correcto, nunca a un broadcast global.
   */
  notificarActualizacionPedido(pedidoId: string, payload: Record<string, unknown>) {
    this.server.to(roomPedido(pedidoId)).emit('pedido-actualizado', {
      id: pedidoId,
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }
}
