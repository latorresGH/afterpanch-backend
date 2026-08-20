import { Injectable } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { parse as parseCookie } from 'cookie';
import { JwtStrategy } from '../auth/jwt.strategy';
import { AUTH_COOKIE_NAME } from '../auth/auth-cookie.util';
import { PrismaService } from '../prisma/prisma.service';
import { tieneAccesoTracking } from './tracking.util';

const ROOM_STAFF = 'staff';
const roomPedido = (id: string) => `pedido:${id}`;

/**
 * Códigos de `join-error` que el frontend distingue. `SESION_INVALIDA` es el
 * único que debe disparar logout: significa que la cookie no llegó, venció o
 * el usuario ya no existe / está inactivo, y reintentar no lo va a arreglar.
 * `ROL_NO_AUTORIZADO` es un estado legítimo (un CLIENTE o DELIVERY conectado
 * al mismo gateway), no un problema de sesión.
 */
export const WS_JOIN_ERROR = {
  SESION_INVALIDA: 'SESION_INVALIDA',
  ROL_NO_AUTORIZADO: 'ROL_NO_AUTORIZADO',
} as const;

/** Lo que queda guardado en `client.data.user` tras el handshake. */
export interface UsuarioSocket {
  sub: string;
  role: Role;
  email: string;
  nombre: string;
}

const ORIGENES_DEV = ['http://localhost:3000', 'http://127.0.0.1:3000'];

/**
 * Devuelve el origin con y sin `www.`. En producción el staff entra por
 * `https://www.afterpanch.com.ar`, pero FRONTEND_URL puede estar seteado sin
 * www (o al revés): sin esta expansión, parte del staff queda afuera del
 * socket según por dónde haya entrado.
 */
function conYSinWww(origen: string): string[] {
  const limpio = origen.trim().replace(/\/+$/, '');
  try {
    const url = new URL(limpio);
    const hostSinWww = url.host.startsWith('www.')
      ? url.host.slice(4)
      : url.host;
    return [
      `${url.protocol}//${hostSinWww}`,
      `${url.protocol}//www.${hostSinWww}`,
    ];
  } catch {
    // No es una URL parseable: se deja tal cual y simplemente no va a matchear.
    return [limpio];
  }
}

/**
 * Allowlist de orígenes del WebSocket. Lee `process.env` en cada llamada a
 * propósito (y no una sola vez al cargar el módulo) para que los tests puedan
 * cambiar FRONTEND_URL sin tener que recargar el módulo.
 */
export function construirOrigenesPermitidos(
  frontendUrl: string | undefined = process.env.FRONTEND_URL,
): string[] {
  const desdeEnv = (frontendUrl ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const expandidos = new Set<string>();
  for (const origen of [...ORIGENES_DEV, ...desdeEnv]) {
    for (const variante of conYSinWww(origen)) expandidos.add(variante);
  }
  return [...expandidos];
}

export function origenPermitido(origen: string | undefined): boolean {
  // Sin header `Origin` no hay navegador del otro lado (healthcheck, script,
  // cliente nativo). Se deja pasar igual que en el CORS HTTP de main.ts: por sí
  // solo no gana nada, porque entrar a la room de staff sigue exigiendo cookie.
  if (!origen) return true;
  return construirOrigenesPermitidos().includes(origen);
}

@Injectable()
@WebSocketGateway({
  cors: {
    // Callback en vez de string: el CORS de socket.io corre ANTES que
    // handleConnection y aplica al handshake de polling. Si acá quedara solo
    // FRONTEND_URL, el origin con www se rechazaría antes de que el chequeo de
    // handleConnection llegue a correr. Las dos capas comparten la allowlist.
    origin: (origin, callback) => {
      if (origenPermitido(origin)) return callback(null, true);
      return callback(new Error('Origin no permitido (WebSocket)'), false);
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
})
export class PedidosGateway implements OnGatewayInit, OnGatewayConnection {
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
   * 🍪 Autenticación en el handshake.
   *
   * El JWT ya no viaja en el body de `join-staff`: el cliente no puede leer una
   * cookie HttpOnly, así que ese camino quedó muerto al migrar el auth HTTP.
   * Ahora el navegador manda la cookie sola en el handshake y el usuario se
   * resuelve UNA vez por conexión.
   *
   * Importante: una cookie ausente o inválida NO rechaza la conexión. El mismo
   * gateway atiende `join-pedido`, el tracking público del cliente, que es
   * anónimo por diseño. Solo `join-staff` exige usuario.
   */
  async handleConnection(client: Socket) {
    if (!origenPermitido(client.handshake.headers.origin)) {
      client.disconnect(true);
      return;
    }

    client.data.user = await this.resolverUsuarioDelHandshake(client);
  }

  /**
   * Los mismos dos pasos que hacía `handleJoinStaff` con el token del body:
   * verificar la firma del JWT y revalidar contra la DB con
   * `JwtStrategy.validate` (usuario existente + activo), que es la misma
   * comprobación que protege las rutas HTTP. Devuelve `null` ante cualquier
   * fallo; no distingue el motivo a propósito.
   */
  private async resolverUsuarioDelHandshake(
    client: Socket,
  ): Promise<UsuarioSocket | null> {
    const header = client.handshake.headers.cookie;
    if (!header) return null;

    let token: string | undefined;
    try {
      // cookie-parser es middleware de Express y no corre para socket.io, así
      // que el header crudo hay que parsearlo a mano con el paquete `cookie`.
      // Está declarado en package.json a propósito: antes se usaba como
      // dependencia transitiva de cookie-parser, y un dedupe o un bump de ese
      // paquete lo podía mover y romper el build sin aviso.
      //
      // Ojo con el tipo: @types/cookie declara `Record<string, string>`, pero
      // si la cookie no vino el valor real en runtime es `undefined`. El
      // chequeo de abajo no es decorativo, es lo único que cubre ese caso.
      token = parseCookie(header)[AUTH_COOKIE_NAME];
    } catch {
      return null;
    }
    if (!token) return null;

    try {
      const payload = await this.jwtService.verifyAsync(token);
      return (await this.jwtStrategy.validate(payload)) as UsuarioSocket;
    } catch {
      return null;
    }
  }

  /**
   * Un socket de staff (campanita admin/POS) pide entrar a la room. El usuario
   * ya viene resuelto del handshake; acá solo se chequea el rol. La regla de
   * roles no cambió: cambió de dónde sale el usuario.
   */
  @SubscribeMessage('join-staff')
  handleJoinStaff(@ConnectedSocket() client: Socket) {
    const user: UsuarioSocket | null = client.data?.user ?? null;

    if (!user) {
      client.emit('join-error', {
        room: ROOM_STAFF,
        code: WS_JOIN_ERROR.SESION_INVALIDA,
        message: 'Sesión inválida o vencida',
      });
      return;
    }

    if (user.role !== Role.ADMIN && user.role !== Role.TRABAJADOR) {
      client.emit('join-error', {
        room: ROOM_STAFF,
        code: WS_JOIN_ERROR.ROL_NO_AUTORIZADO,
        message: 'Rol no autorizado',
      });
      return;
    }

    client.join(ROOM_STAFF);
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
   * Aviso al staff de que la lista de pedidos cambió.
   *
   * `notificarActualizacionPedido` solo llega a la room `pedido:${id}` (el
   * tracking del cliente), así que un cambio hecho desde OTRA terminal nunca
   * llegaba al monitor del POS: se enteraba recién en el siguiente tick del
   * polling. Este evento cubre ese hueco.
   *
   * Es deliberadamente un aviso "algo cambió", sin los datos del pedido: el
   * cliente refetchea GET /pedidos/activos, que ya es barato. Así no hay dos
   * formas distintas de armar el mismo objeto ni riesgo de que el payload del
   * socket quede desincronizado del endpoint.
   */
  notificarCambioPedidos(motivo: string, pedidoId?: string) {
    this.server.to(ROOM_STAFF).emit('pedidos-actualizados', {
      motivo,
      pedidoId,
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
