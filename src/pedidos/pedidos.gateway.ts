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

/**
 * 🔎 DIAGNÓSTICO TEMPORAL — grepear por `[WS-DIAG]`.
 *
 * Motivo concreto por el que un handshake quedó sin usuario. Hoy
 * `resolverUsuarioDelHandshake` colapsa cinco causas muy distintas en el mismo
 * `null`, y desde afuera no hay forma de saber cuál fue: el frontend recibe
 * siempre `SESION_INVALIDA`. Esto NO cambia esa lógica, solo la etiqueta para
 * poder leerla en los logs de producción.
 *
 * TODO [WS-DIAG]: borrar este andamiaje entero (`MotivoSinUsuario`,
 * `ResultadoHandshake`, `logDiagnostico` y `logDiagnosticoJoinStaff`) junto
 * con sus `console.log('[WS-DIAG]', ...)` cuando prod acumule ~1 semana sin
 * una sola línea `authResuelta:false`. La condición completa está en el
 * docblock de `logDiagnosticoJoinStaff`.
 */
type MotivoSinUsuario =
  | 'SIN_COOKIE_HEADER' // el handshake no trajo ningún header `cookie`
  | 'COOKIE_ILEGIBLE' // vino el header pero `parseCookie` tiró
  | 'SIN_COOKIE_AUTH' // vinieron cookies, pero no `afterpanch_token`
  | 'JWT_INVALIDO' // llegó el token pero no verifica (firma/expiración)
  | 'USUARIO_INVALIDO'; // JWT válido, pero el usuario no existe o está inactivo

/** Resultado del handshake: el usuario de siempre + la etiqueta de diagnóstico. */
interface ResultadoHandshake {
  user: UsuarioSocket | null;
  motivo: MotivoSinUsuario | null;
  /** Vino el header `cookie` (con lo que sea adentro). */
  tieneCookieHeader: boolean;
  /** Dentro de ese header estaba `afterpanch_token` específicamente. */
  contieneAuthToken: boolean;
  /**
   * NOMBRES de las cookies que sí llegaron — nunca sus valores. Es el dato que
   * separa las dos hipótesis: si llegaron otras cookies pero no la de auth, el
   * problema es de scope (path/domain); si no llegó ninguna, es del transporte
   * o del navegador.
   */
  cookiesPresentes: string[];
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
    // Callback en vez de string: el CORS de socket.io corre ANTES que el
    // middleware de `afterInit` y aplica al handshake de polling. Si acá
    // quedara solo FRONTEND_URL, el origin con www se rechazaría antes de que
    // el chequeo del middleware llegue a correr.
    //
    // Esta capa NO alcanza sola: CORS es un mecanismo del navegador sobre HTTP
    // y no cubre el transporte websocket. Quien manda es el middleware; las
    // dos comparten la misma allowlist vía `origenPermitido`.
    origin: (origin, callback) => {
      if (origenPermitido(origin)) return callback(null, true);
      return callback(new Error('Origin no permitido (WebSocket)'), false);
    },
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

  /**
   * Registra el middleware del handshake ANTES de que socket.io pueda emitir
   * el paquete CONNECT de ningún cliente.
   *
   * 🏁 Esto es lo que cierra la carrera de timing (Capa 2). Antes la auth vivía
   * en `handleConnection`, que Nest invoca DESPUÉS de que socket.io ya le mandó
   * el CONNECT al cliente — y como era `async`, nadie esperaba su promesa. En
   * ese hueco el cliente veía `connect`, emitía `join-staff` y
   * `client.data.user` todavía no existía: SESION_INVALIDA con la cookie
   * perfecta. Pasó en producción.
   *
   * socket.io NO emite el CONNECT hasta que el último middleware llama
   * `next()`, así que el cliente no puede emitir `join-staff` antes de que
   * `socket.data.user` esté seteado. La ventana no se mitiga: deja de existir.
   *
   * Ojo si algún día este gateway pasa a tener `namespace`: `server.use()`
   * registra en el namespace `/`, y el middleware tendría que mudarse con él.
   */
  afterInit(server: Server) {
    // El middleware es `async` a propósito y se registra tal cual (en vez de
    // envolverlo en uno sincrónico con `void`): así devuelve la promesa del
    // handshake, que es lo que el spec necesita para poder awaitearlo y
    // verificar que `next()` se llamó exactamente una vez.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    server.use(async (socket, next) => {
      // ── Bloque 1 — origin. FAIL-CLOSED ────────────────────────────────────
      // Un chequeo de origin que explota no puede degradar a "pasá": es un
      // límite de seguridad, se cierra. Acá manda el middleware y NO el `cors`
      // del decorator: CORS es un mecanismo del navegador sobre HTTP y no
      // cubre el transporte websocket (`new WebSocket(...)` no hace preflight
      // ni respeta Access-Control-Allow-Origin). El `cors` del decorator sigue
      // en su lugar para el handshake de polling; las dos capas comparten una
      // sola allowlist vía `origenPermitido`.
      try {
        if (!origenPermitido(socket.handshake?.headers?.origin)) {
          return next(new Error('Origin no permitido (WebSocket)'));
        }
      } catch {
        return next(new Error('Origin no permitido (WebSocket)'));
      }

      // ── Bloque 2 — auth. FAIL-OPEN a usuario null ─────────────────────────
      // ⚠️ REGLA INVARIABLE: la falta de usuario NUNCA rechaza la conexión.
      // Este mismo gateway atiende `join-pedido`, el tracking público del
      // cliente, que es anónimo por diseño: un `next(err)` acá por no haber
      // cookie rompería el seguimiento de todos los pedidos. Solo `join-staff`
      // exige usuario, y lo chequea él.
      //
      // El try/catch no es decorativo: socket.io IGNORA el valor de retorno de
      // un middleware async, así que una excepción acá no la agarra nadie —
      // quedaría como unhandled rejection y ese socket nunca recibiría el
      // CONNECT (se cuelga hasta el timeout).
      try {
        const resultado = await this.resolverUsuarioDelHandshake(socket);
        socket.data.user = resultado.user;

        // 🔎 DIAGNÓSTICO TEMPORAL — grepear por `[WS-DIAG]`. Ver
        // `MotivoSinUsuario`.
        this.logDiagnostico(socket, resultado);
      } catch (e) {
        // Asignar `null` explícito no es redundante: `handleJoinStaff` y
        // `getStaffConectados` leen esta clave, y dejarla sin definir devuelve
        // al estado ambiguo que este cambio elimina.
        socket.data.user = null;
        console.error('[WS] fallo inesperado resolviendo el handshake', e);
      }

      // Único `next()` sin argumentos, y fuera de todo `if`: se llama SIEMPRE,
      // haya usuario o no. La única llamada con error en este middleware es la
      // del origin, más arriba.
      next();
    });

    console.log('[WebSocket] PedidosGateway initialized');
  }

  /**
   * 🔎 DIAGNÓSTICO TEMPORAL — grepear por `[WS-DIAG]`.
   *
   * Solo escribe logs: no toca `client.data`, no emite, no desconecta, no
   * cambia ninguna decisión. Todo va con optional chaining y dentro de un
   * try/catch porque un handshake raro (o un socket mockeado) no puede tumbar
   * una conexión por culpa de una línea de diagnóstico.
   *
   * Nunca loguea el token ni el valor de ninguna cookie: solo presencia,
   * ausencia y nombres.
   */
  private logDiagnostico(client: Socket, resultado: ResultadoHandshake) {
    try {
      const handshake = client.handshake as Socket['handshake'] | undefined;
      const headers = handshake?.headers ?? {};

      const contexto = {
        // `sid` + `t` son lo que permite cruzar esta línea con la de
        // `[WS-DIAG] join-staff`: mismo socket, y el orden temporal exacto
        // entre que terminó la auth del handshake y que llegó el join.
        sid: client.id,
        t: new Date().toISOString(),
        // 🔑 La hipótesis del path se confirma o se cae acá: `url` es la ruta
        // exacta del handshake (ej. `/socket.io/?EIO=4&transport=polling`).
        // La cookie hoy se setea con `path: '/'`, que matchea cualquier ruta,
        // así que si el path fuera el problema tendría que verse algo distinto
        // de `/socket.io/` en esta línea.
        path: handshake?.url,
        transport: client.conn?.transport?.name,
        origin: headers.origin,
        host: headers.host,
        // Relevante por el flag `secure` de la cookie: dice con qué esquema
        // llegó la request del otro lado del Cloudflare Tunnel.
        proto: headers['x-forwarded-proto'],
      };

      if (resultado.user) {
        console.log('[WS-DIAG] handshake OK', {
          ...contexto,
          role: resultado.user.role,
        });
        return;
      }

      console.log('[WS-DIAG] handshake sin usuario', {
        motivo: resultado.motivo,
        tieneCookieHeader: resultado.tieneCookieHeader,
        contieneAuthToken: resultado.contieneAuthToken,
        cookiesPresentes: resultado.cookiesPresentes,
        ...contexto,
      });
    } catch (e) {
      console.log('[WS-DIAG] no se pudo loguear el handshake', e);
    }
  }

  /**
   * Los mismos dos pasos que hacía `handleJoinStaff` con el token del body:
   * verificar la firma del JWT y revalidar contra la DB con
   * `JwtStrategy.validate` (usuario existente + activo), que es la misma
   * comprobación que protege las rutas HTTP. Devuelve `user: null` ante
   * cualquier fallo, exactamente igual que antes.
   *
   * 🔎 Lo único que cambió: además del usuario devuelve el `motivo` del null.
   * Es SOLO para el log de diagnóstico — ningún consumidor lo mira para
   * decidir nada, `handleJoinStaff` sigue viendo el mismo `client.data.user`
   * de siempre y sigue respondiendo el mismo `SESION_INVALIDA`.
   */
  private async resolverUsuarioDelHandshake(
    client: Socket,
  ): Promise<ResultadoHandshake> {
    const header = client.handshake.headers.cookie;
    if (!header) {
      return {
        user: null,
        motivo: 'SIN_COOKIE_HEADER',
        tieneCookieHeader: false,
        contieneAuthToken: false,
        cookiesPresentes: [],
      };
    }

    let cookies: Record<string, string | undefined>;
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
      cookies = parseCookie(header);
      token = cookies[AUTH_COOKIE_NAME];
    } catch {
      return {
        user: null,
        motivo: 'COOKIE_ILEGIBLE',
        tieneCookieHeader: true,
        contieneAuthToken: false,
        cookiesPresentes: [],
      };
    }

    // Solo los NOMBRES, nunca los valores.
    const cookiesPresentes = Object.keys(cookies);

    if (!token) {
      return {
        user: null,
        motivo: 'SIN_COOKIE_AUTH',
        tieneCookieHeader: true,
        contieneAuthToken: false,
        cookiesPresentes,
      };
    }

    // Los dos `await` van en try/catch separados solo para poder distinguir
    // "el JWT no verifica" de "el usuario ya no sirve". Las llamadas, su orden
    // y el resultado (`null` ante cualquier throw) son idénticos a antes.
    let payload: unknown;
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      return {
        user: null,
        motivo: 'JWT_INVALIDO',
        tieneCookieHeader: true,
        contieneAuthToken: true,
        cookiesPresentes,
      };
    }

    try {
      const user = (await this.jwtStrategy.validate(payload)) as UsuarioSocket;
      return {
        user,
        motivo: null,
        tieneCookieHeader: true,
        contieneAuthToken: true,
        cookiesPresentes,
      };
    } catch {
      return {
        user: null,
        motivo: 'USUARIO_INVALIDO',
        tieneCookieHeader: true,
        contieneAuthToken: true,
        cookiesPresentes,
      };
    }
  }

  /**
   * 🔎 DIAGNÓSTICO TEMPORAL — grepear por `[WS-DIAG]`.
   *
   * Esto es el CRITERIO DE ACEPTACIÓN de la Capa 2, no instrumentación
   * sobrante. Medía la carrera de timing: cuando la auth vivía en
   * `handleConnection` (async, invocada DESPUÉS del paquete CONNECT y sin que
   * nadie esperara su promesa), un `join-staff` podía llegar mientras la auth
   * seguía esperando a la DB, y `handleJoinStaff` respondía SESION_INVALIDA
   * con la cookie perfecta. `authResuelta: false` es exactamente esa carrera,
   * y en producción apareció.
   *
   * Con la auth en el middleware de `afterInit`, socket.io no manda el CONNECT
   * hasta que el middleware llama `next()`, así que `authResuelta` tiene que
   * dar `true` SIEMPRE. Este log es lo único que lo verifica desde afuera.
   *
   * TODO [WS-DIAG]: borrar este método, `logDiagnostico` y el andamiaje de
   * `MotivoSinUsuario`/`ResultadoHandshake` cuando prod acumule ~1 semana sin
   * una sola línea `authResuelta:false`. Hasta entonces se queda: sin él no
   * hay forma de confirmar que la Capa 2 hizo lo que dice.
   *
   * - `authResuelta: true` + `tieneUsuario: false` → la auth terminó y dio
   *   null de verdad; el motivo está en `[WS-DIAG] handshake sin usuario`.
   * - `authResuelta: false` → NO debería poder pasar más. Si aparece, el
   *   middleware no se registró o algo lo saltea.
   *
   * Solo escribe logs: no toca `client.data`, no emite, no desconecta, no
   * cambia ninguna decisión.
   */
  private logDiagnosticoJoinStaff(client: Socket) {
    try {
      const data = client.data as Record<string, unknown> | undefined;

      console.log('[WS-DIAG] join-staff', {
        sid: client.id,
        t: new Date().toISOString(),
        // La clave `user` solo existe una vez que el middleware del handshake
        // terminó de asignarla, así que su presencia es exactamente "la auth
        // del handshake ya corrió". Es distinto de `tieneUsuario`.
        authResuelta: !!data && 'user' in data,
        tieneUsuario: !!data?.user,
        transport: client.conn?.transport?.name,
      });
    } catch (e) {
      console.log('[WS-DIAG] no se pudo loguear el join-staff', e);
    }
  }

  /**
   * Un socket de staff (campanita admin/POS) pide entrar a la room. El usuario
   * ya viene resuelto del handshake; acá solo se chequea el rol. La regla de
   * roles no cambió: cambió de dónde sale el usuario.
   *
   * Desde la Capa 2 el middleware de `afterInit` garantiza que
   * `client.data.user` ya está resuelto antes de que este handler pueda
   * ejecutarse, así que `SESION_INVALIDA` recuperó su significado literal:
   * "no hay usuario", y ya no también "todavía no terminé de averiguarlo".
   */
  @SubscribeMessage('join-staff')
  handleJoinStaff(@ConnectedSocket() client: Socket) {
    // 🔎 DIAGNÓSTICO TEMPORAL — grepear por `[WS-DIAG]`. Solo log, va primero
    // para que el timestamp sea el de la llegada del mensaje.
    this.logDiagnosticoJoinStaff(client);

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
   * Ids (`sub`) del staff con una pantalla abierta ahora mismo.
   *
   * Sale de los sockets que están en la room `staff`, cada uno con su usuario
   * ya resuelto en el handshake (`client.data.user`). Es SOLO LECTURA: no
   * toca la autenticación ni las rooms.
   *
   * Tres límites, a tener presentes antes de leer esto como un fichaje:
   * 1. "Conectado" significa que tiene abierta alguna pantalla con la
   *    campanita (/pos, /admin, /caja, /cocina). Es un proxy de "está en
   *    turno", no una marcación de entrada.
   * 2. `fetchSockets()` mira SOLO este proceso. Con un contenedor alcanza; si
   *    algún día hay varias instancias hace falta el adapter de Redis.
   * 3. DELIVERY nunca aparece: solo ADMIN/TRABAJADOR entran a la room staff.
   */
  async getStaffConectados(): Promise<Set<string>> {
    try {
      const sockets = await this.server.in(ROOM_STAFF).fetchSockets();
      const ids = sockets
        .map((socket) => (socket.data as { user?: UsuarioSocket })?.user?.sub)
        .filter((sub): sub is string => typeof sub === 'string');
      return new Set(ids);
    } catch {
      // La presencia es decorativa: si el adapter falla, el Home tiene que
      // seguir respondiendo, con todo el equipo mostrado como desconectado.
      return new Set();
    }
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
  notificarActualizacionPedido(
    pedidoId: string,
    payload: Record<string, unknown>,
  ) {
    this.server.to(roomPedido(pedidoId)).emit('pedido-actualizado', {
      id: pedidoId,
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }
}
