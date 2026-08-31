import { Role } from '@prisma/client';
import {
  PedidosGateway,
  WS_JOIN_ERROR,
  construirOrigenesPermitidos,
  origenPermitido,
} from './pedidos.gateway';

const FRONTEND_URL_ORIGINAL = process.env.FRONTEND_URL;

/** Origin que la allowlist acepta en todos los tests de abajo. */
const ORIGIN_OK = 'https://www.afterpanch.com.ar';

/**
 * El middleware que `afterInit` registra con `server.use()`. Es async a
 * propósito: el harness lo awaitea para saber que el handshake terminó.
 */
type MiddlewareHandshake = (
  socket: any,
  next: (err?: Error) => void,
) => Promise<void>;

let contadorSockets = 0;

/**
 * Socket falso con lo mínimo que toca el gateway. Guarda lo emitido y las
 * rooms para poder asertar sobre eso.
 */
function socketFalso(opts: { origin?: string; cookie?: string } = {}) {
  const emitidos: Array<{ evento: string; payload: any }> = [];
  const rooms: string[] = [];
  return {
    // `id` y `conn` los lee el logging [WS-DIAG]. Hoy sobrevive sin ellos por
    // optional chaining, pero el socket falso tiene que parecerse al real.
    id: `sock-${++contadorSockets}`,
    conn: { transport: { name: 'websocket' } },
    handshake: { headers: { origin: opts.origin, cookie: opts.cookie } },
    data: {} as Record<string, any>,
    emit: jest.fn((evento: string, payload: any) => {
      emitidos.push({ evento, payload });
      return true;
    }),
    join: jest.fn((room: string) => {
      rooms.push(room);
    }),
    disconnect: jest.fn(),
    emitidos,
    rooms,
  } as any;
}

const USUARIO_ADMIN = {
  sub: 'u-1',
  role: Role.ADMIN,
  email: 'admin@afterpanch.com.ar',
  nombre: 'Maxi',
};

describe('PedidosGateway — auth por cookie en el middleware del handshake', () => {
  let gateway: PedidosGateway;
  let jwtService: { verifyAsync: jest.Mock };
  let jwtStrategy: { validate: jest.Mock };
  let prisma: { pedido: { findUnique: jest.Mock } };
  let middleware: MiddlewareHandshake;

  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://afterpanch.com.ar';
    jwtService = { verifyAsync: jest.fn() };
    jwtStrategy = { validate: jest.fn() };
    prisma = { pedido: { findUnique: jest.fn() } };
    gateway = new PedidosGateway(
      jwtService as any,
      jwtStrategy as any,
      prisma as any,
    );

    // El logging [WS-DIAG] escribe una línea por conexión: sin esto el spec
    // escupe ruido de diagnóstico en cada test.
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    // La auth ya no vive en `handleConnection` (que se borró): vive en el
    // middleware que `afterInit` registra. Lo extraemos del `server.use`
    // mockeado y es eso lo que ejercitan los tests.
    const server = { use: jest.fn() };
    gateway.afterInit(server as any);
    middleware = server.use.mock.calls[0][0] as MiddlewareHandshake;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env.FRONTEND_URL = FRONTEND_URL_ORIGINAL;
  });

  /**
   * Corre el handshake completo de un socket y devuelve el error que el
   * middleware le pasó a `next()` (o `undefined` si lo dejó conectar).
   *
   * El `expect` de adentro no es un test suelto: es la invariante del gateway
   * aplicada a TODOS los tests que conectan un socket. Pase lo que pase
   * —origin rechazado, cookie ausente, JWT vencido, throw inesperado— `next()`
   * se llama exactamente una vez. Si se llamara cero veces, el socket real se
   * colgaría sin recibir nunca el paquete CONNECT.
   */
  async function conectar(client: any): Promise<Error | undefined> {
    const next = jest.fn();
    await middleware(client, next);
    expect(next).toHaveBeenCalledTimes(1);
    return next.mock.calls[0][0] as Error | undefined;
  }

  // ----------------------------------------------------------------------
  describe('allowlist de orígenes', () => {
    it('acepta el origin con y sin www aunque FRONTEND_URL traiga solo uno', () => {
      process.env.FRONTEND_URL = 'https://afterpanch.com.ar';
      expect(origenPermitido('https://afterpanch.com.ar')).toBe(true);
      // El caso real de producción: el staff entra por www.
      expect(origenPermitido('https://www.afterpanch.com.ar')).toBe(true);
    });

    it('funciona igual si FRONTEND_URL viene con www', () => {
      process.env.FRONTEND_URL = 'https://www.afterpanch.com.ar';
      expect(origenPermitido('https://afterpanch.com.ar')).toBe(true);
      expect(origenPermitido('https://www.afterpanch.com.ar')).toBe(true);
    });

    it('soporta varios orígenes separados por coma', () => {
      process.env.FRONTEND_URL =
        'https://afterpanch.com.ar, https://staging.afterpanch.com.ar';
      expect(origenPermitido('https://staging.afterpanch.com.ar')).toBe(true);
      expect(origenPermitido('https://www.staging.afterpanch.com.ar')).toBe(
        true,
      );
    });

    it('mantiene localhost para desarrollo', () => {
      expect(origenPermitido('http://localhost:3000')).toBe(true);
      expect(origenPermitido('http://127.0.0.1:3000')).toBe(true);
    });

    it('rechaza un origin ajeno', () => {
      expect(origenPermitido('https://sitio-malicioso.com')).toBe(false);
      // Ojo con el sufijo: no alcanza con terminar parecido.
      expect(origenPermitido('https://afterpanch.com.ar.evil.com')).toBe(false);
    });

    it('no confunde http con https', () => {
      expect(origenPermitido('http://afterpanch.com.ar')).toBe(false);
    });

    it('deja pasar la conexión sin header Origin (no es un navegador)', () => {
      expect(origenPermitido(undefined)).toBe(true);
    });

    it('no duplica variantes en la lista', () => {
      process.env.FRONTEND_URL =
        'https://afterpanch.com.ar,https://www.afterpanch.com.ar';
      const lista = construirOrigenesPermitidos();
      expect(new Set(lista).size).toBe(lista.length);
    });
  });

  // ----------------------------------------------------------------------
  describe('afterInit', () => {
    it('registra exactamente un middleware en el server', () => {
      const server = { use: jest.fn() };
      gateway.afterInit(server as any);

      expect(server.use).toHaveBeenCalledTimes(1);
      expect(typeof server.use.mock.calls[0][0]).toBe('function');
    });
  });

  // ----------------------------------------------------------------------
  describe('middleware del handshake', () => {
    it('resuelve el usuario desde la cookie del handshake', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'u-1' });
      jwtStrategy.validate.mockResolvedValue(USUARIO_ADMIN);

      const client = socketFalso({
        origin: ORIGIN_OK,
        cookie: 'otra=x; afterpanch_token=jwt-valido; mas=y',
      });

      const err = await conectar(client);

      // Parseó el header crudo y extrajo SOLO la cookie de auth.
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('jwt-valido');
      // Revalidó contra DB con la misma lógica que las rutas HTTP.
      expect(jwtStrategy.validate).toHaveBeenCalledWith({ sub: 'u-1' });
      expect(client.data.user).toEqual(USUARIO_ADMIN);
      expect(err).toBeUndefined();
    });

    it('conecta SIN usuario si no hay cookie (tracking público)', async () => {
      const client = socketFalso({ origin: ORIGIN_OK });

      const err = await conectar(client);

      // Lo que importa no es solo que el usuario sea null: es que el socket
      // CONECTA igual. Un next(err) acá rompería todo el tracking anónimo.
      expect(err).toBeUndefined();
      expect(client.data.user).toBeNull();
    });

    it('conecta SIN usuario si el JWT es inválido, sin tirar', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

      const client = socketFalso({
        origin: ORIGIN_OK,
        cookie: 'afterpanch_token=vencido',
      });

      const err = await conectar(client);

      expect(err).toBeUndefined();
      expect(client.data.user).toBeNull();
    });

    it('conecta SIN usuario si el usuario fue desactivado o borrado', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'u-1' });
      jwtStrategy.validate.mockRejectedValue(new Error('Usuario desactivado'));

      const client = socketFalso({
        origin: ORIGIN_OK,
        cookie: 'afterpanch_token=firma-ok-pero-usuario-inactivo',
      });

      const err = await conectar(client);

      expect(err).toBeUndefined();
      expect(client.data.user).toBeNull();
    });

    it('ignora un header de cookies sin la cookie de auth', async () => {
      const client = socketFalso({
        origin: ORIGIN_OK,
        cookie: 'analytics=abc; theme=dark',
      });

      const err = await conectar(client);

      expect(err).toBeUndefined();
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
      expect(client.data.user).toBeNull();
    });

    it('deja la clave `user` SIEMPRE definida, aunque valga null', async () => {
      // `handleJoinStaff` y `getStaffConectados` leen esta clave. Que exista
      // siempre es lo que elimina el estado ambiguo "todavía no sé".
      const client = socketFalso({ origin: ORIGIN_OK });

      await conectar(client);

      expect('user' in client.data).toBe(true);
    });
  });

  // ----------------------------------------------------------------------
  describe('la carrera de timing (lo que arregla la Capa 2)', () => {
    it('el usuario YA está resuelto cuando el middleware llama a next()', async () => {
      // `validate` queda colgada hasta que la soltemos a mano: simula la
      // latencia de la DB, que era exactamente la ventana de la carrera.
      let soltarValidate!: (u: unknown) => void;
      jwtService.verifyAsync.mockResolvedValue({ sub: 'u-1' });
      jwtStrategy.validate.mockReturnValue(
        new Promise((resolve) => {
          soltarValidate = resolve;
        }),
      );

      const client = socketFalso({
        origin: ORIGIN_OK,
        cookie: 'afterpanch_token=jwt-valido',
      });

      // Foto del estado de `client.data` EN EL INSTANTE de next().
      let foto: { authResuelta: boolean; user: unknown } | null = null;
      const next = jest.fn(() => {
        foto = {
          authResuelta: 'user' in client.data,
          user: client.data.user,
        };
      });

      const enVuelo = middleware(client, next);

      // Mientras la DB no contesta, next() NO se llamó: o sea que socket.io
      // todavía no mandó el CONNECT y el cliente ni siquiera puede emitir
      // `join-staff`. Ésa es la garantía estructural, no una mitigación.
      await new Promise((r) => setImmediate(r));
      expect(next).not.toHaveBeenCalled();

      soltarValidate(USUARIO_ADMIN);
      await enVuelo;

      expect(next).toHaveBeenCalledTimes(1);
      // Antes de la Capa 2 esto era `{ authResuelta: false, user: undefined }`
      // en la ventana de la carrera → SESION_INVALIDA con la cookie perfecta.
      expect(foto).toEqual({ authResuelta: true, user: USUARIO_ADMIN });
    });
  });

  // ----------------------------------------------------------------------
  describe('política de fallos: origin FAIL-CLOSED vs auth FAIL-OPEN', () => {
    it('origin no permitido → RECHAZA la conexión (fail-closed)', async () => {
      const client = socketFalso({ origin: 'https://sitio-malicioso.com' });

      const err = await conectar(client);

      expect(err).toBeInstanceOf(Error);
      // Corta antes de tocar la auth: no gasta ni un verify ni una query.
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
      // Ya no conecta-y-después-desconecta: directamente no conecta, así que
      // no hay ventana para que emita join-pedido / join-staff.
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('auth fallida → CONECTA igual, sin usuario (fail-open)', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
      const client = socketFalso({
        origin: ORIGIN_OK,
        cookie: 'afterpanch_token=vencido',
      });

      const err = await conectar(client);

      // El par completo: mismo middleware, dos políticas opuestas a propósito.
      // Un límite de seguridad se cierra; un fallo de auth degrada a anónimo.
      expect(err).toBeUndefined();
      expect(client.data.user).toBeNull();
    });

    it('un throw inesperado resolviendo el handshake no tumba la conexión', async () => {
      jest
        .spyOn(gateway as any, 'resolverUsuarioDelHandshake')
        .mockRejectedValue(new Error('boom'));

      const client = socketFalso({
        origin: ORIGIN_OK,
        cookie: 'afterpanch_token=jwt-valido',
      });

      const err = await conectar(client);

      // El middleware corre para TODOS los sockets: un throw sin capturar acá
      // dejaría a cada conexión sin CONNECT, colgada hasta el timeout.
      expect(err).toBeUndefined();
      expect(client.data.user).toBeNull();
      expect(console.error).toHaveBeenCalled();

      // Y el socket sigue usable: join-staff responde en vez de explotar.
      gateway.handleJoinStaff(client);
      expect(client.rooms).not.toContain('staff');
      expect(client.emitidos[0].payload.code).toBe(
        WS_JOIN_ERROR.SESION_INVALIDA,
      );
    });
  });

  // ----------------------------------------------------------------------
  describe('join-staff', () => {
    async function conectarComo(role: Role) {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'u-1' });
      jwtStrategy.validate.mockResolvedValue({ ...USUARIO_ADMIN, role });
      const client = socketFalso({
        origin: ORIGIN_OK,
        cookie: 'afterpanch_token=jwt-valido',
      });
      await conectar(client);
      return client;
    }

    it.each([Role.ADMIN, Role.TRABAJADOR])(
      'deja entrar a la room de staff a %s',
      async (role) => {
        const client = await conectarComo(role);

        gateway.handleJoinStaff(client);

        expect(client.rooms).toContain('staff');
        expect(client.emit).not.toHaveBeenCalled();
      },
    );

    it.each([Role.CLIENTE, Role.DELIVERY])(
      'rechaza a %s con ROL_NO_AUTORIZADO',
      async (role) => {
        const client = await conectarComo(role);

        gateway.handleJoinStaff(client);

        expect(client.rooms).not.toContain('staff');
        expect(client.emitidos[0].evento).toBe('join-error');
        expect(client.emitidos[0].payload.code).toBe(
          WS_JOIN_ERROR.ROL_NO_AUTORIZADO,
        );
      },
    );

    it('sin sesión válida emite SESION_INVALIDA (distinguible para el logout)', async () => {
      const client = socketFalso({ origin: ORIGIN_OK });
      await conectar(client);

      gateway.handleJoinStaff(client);

      expect(client.rooms).not.toContain('staff');
      expect(client.emitidos[0].payload.code).toBe(
        WS_JOIN_ERROR.SESION_INVALIDA,
      );
      // El código tiene que ser distinto al de rol, si no el front no puede
      // decidir entre desloguear y no hacer nada.
      expect(WS_JOIN_ERROR.SESION_INVALIDA).not.toBe(
        WS_JOIN_ERROR.ROL_NO_AUTORIZADO,
      );
    });

    it('ya NO acepta un token por el body del mensaje', async () => {
      const client = socketFalso({ origin: ORIGIN_OK });
      await conectar(client);

      // Aunque el cliente mandara el token viejo, no debe servirle de nada.
      (gateway.handleJoinStaff as any)(client, { token: 'jwt-de-admin' });

      expect(client.rooms).not.toContain('staff');
      expect(client.emitidos[0].payload.code).toBe(
        WS_JOIN_ERROR.SESION_INVALIDA,
      );
    });

    it('re-autentica sola tras una reconexión (handshake nuevo)', async () => {
      // Caída de red: socket.io reconecta y rehace el handshake, así que el
      // middleware corre de nuevo y el usuario se resuelve otra vez desde la
      // cookie, sin intervención.
      const primera = await conectarComo(Role.ADMIN);
      gateway.handleJoinStaff(primera);
      expect(primera.rooms).toContain('staff');

      const segunda = await conectarComo(Role.ADMIN);
      gateway.handleJoinStaff(segunda);
      expect(segunda.rooms).toContain('staff');
      expect(segunda.data.user.role).toBe(Role.ADMIN);
    });

    it('tras reconectar con la cookie ya vencida, avisa SESION_INVALIDA', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
      const client = socketFalso({
        origin: ORIGIN_OK,
        cookie: 'afterpanch_token=vencido',
      });
      await conectar(client);

      gateway.handleJoinStaff(client);

      expect(client.emitidos[0].payload.code).toBe(
        WS_JOIN_ERROR.SESION_INVALIDA,
      );
    });
  });

  // ----------------------------------------------------------------------
  describe('join-pedido (tracking público) — no debe cambiar', () => {
    it('une a la room del pedido con el trackingCode correcto, sin JWT', async () => {
      prisma.pedido.findUnique.mockResolvedValue({ trackingCode: 'abc123' });
      const client = socketFalso({ origin: ORIGIN_OK });

      // La regresión más cara de la Capa 2: si el middleware rechazara por
      // falta de usuario, este socket ni siquiera llegaría a conectarse.
      const err = await conectar(client);
      expect(err).toBeUndefined();
      expect(client.data.user).toBeNull(); // anónimo, a propósito

      await gateway.handleJoinPedido(client, { id: 'p-1', code: 'abc123' });

      expect(client.rooms).toContain('pedido:p-1');
    });

    it('rechaza si el code no coincide', async () => {
      prisma.pedido.findUnique.mockResolvedValue({ trackingCode: 'abc123' });
      const client = socketFalso({ origin: ORIGIN_OK });
      await conectar(client);

      await gateway.handleJoinPedido(client, { id: 'p-1', code: 'incorrecto' });

      expect(client.rooms).not.toContain('pedido:p-1');
      expect(client.emitidos[0].payload.message).toBe('Acceso denegado');
    });

    it('exige id', async () => {
      const client = socketFalso({ origin: ORIGIN_OK });
      await conectar(client);

      await gateway.handleJoinPedido(client, {});

      expect(client.emitidos[0].payload.message).toBe('id requerido');
    });
  });

  // ----------------------------------------------------------------------
  describe('emisión a la room de staff', () => {
    it('notificarNuevoPedido emite solo a la room staff', () => {
      const emit = jest.fn();
      const to = jest.fn(() => ({ emit }));
      gateway.server = { to } as any;

      gateway.notificarNuevoPedido({
        id: 'p-1',
        nombreCliente: 'Mesa 6',
        tipo: 'LOCAL',
        total: 9600,
      });

      expect(to).toHaveBeenCalledWith('staff');
      expect(emit).toHaveBeenCalledWith(
        'nuevo-pedido',
        expect.objectContaining({ id: 'p-1', total: 9600 }),
      );
    });

    it('notificarCambioPedidos avisa a la room staff', () => {
      const emit = jest.fn();
      const to = jest.fn(() => ({ emit }));
      gateway.server = { to } as any;

      gateway.notificarCambioPedidos('estado-cambiado', 'p-1');

      expect(to).toHaveBeenCalledWith('staff');
      expect(emit).toHaveBeenCalledWith(
        'pedidos-actualizados',
        expect.objectContaining({ motivo: 'estado-cambiado', pedidoId: 'p-1' }),
      );
    });

    it('notificarCambioPedidos NO manda datos del pedido, solo el aviso', () => {
      // A propósito: el cliente refetchea GET /pedidos/activos. Si mandáramos
      // el pedido acá habría dos formas de armar el mismo objeto.
      const emit = jest.fn();
      gateway.server = { to: jest.fn(() => ({ emit })) } as any;

      gateway.notificarCambioPedidos('pedido-creado', 'p-1');

      const payload = emit.mock.calls[0][1];
      expect(Object.keys(payload).sort()).toEqual([
        'motivo',
        'pedidoId',
        'timestamp',
      ]);
    });

    it('getStaffConectados devuelve los sub de los sockets en la room staff', async () => {
      const inRoom = jest.fn(() => ({
        fetchSockets: jest
          .fn()
          .mockResolvedValue([
            { data: { user: { sub: 'u-1' } } },
            { data: { user: { sub: 'u-2' } } },
          ]),
      }));
      gateway.server = { in: inRoom } as any;

      const conectados = await gateway.getStaffConectados();

      expect(inRoom).toHaveBeenCalledWith('staff');
      expect([...conectados].sort()).toEqual(['u-1', 'u-2']);
    });

    it('getStaffConectados deduplica: una persona con dos pantallas abiertas cuenta una vez', async () => {
      gateway.server = {
        in: () => ({
          fetchSockets: jest
            .fn()
            .mockResolvedValue([
              { data: { user: { sub: 'u-1' } } },
              { data: { user: { sub: 'u-1' } } },
            ]),
        }),
      } as any;

      const conectados = await gateway.getStaffConectados();

      expect(conectados.size).toBe(1);
    });

    it('getStaffConectados ignora sockets sin usuario resuelto', async () => {
      gateway.server = {
        in: () => ({
          fetchSockets: jest
            .fn()
            .mockResolvedValue([
              { data: {} },
              { data: { user: undefined } },
              { data: { user: { sub: 'u-1' } } },
            ]),
        }),
      } as any;

      await expect(gateway.getStaffConectados()).resolves.toEqual(
        new Set(['u-1']),
      );
    });

    it('getStaffConectados no rompe el Home si el adapter falla', async () => {
      gateway.server = {
        in: () => ({
          fetchSockets: jest.fn().mockRejectedValue(new Error('adapter caído')),
        }),
      } as any;

      // La presencia es decorativa: el Home tiene que responder igual.
      await expect(gateway.getStaffConectados()).resolves.toEqual(new Set());
    });

    it('notificarActualizacionPedido sigue yendo SOLO a la room del pedido', () => {
      // El tracking público no debe recibir el evento de staff ni al revés.
      const emit = jest.fn();
      const to = jest.fn(() => ({ emit }));
      gateway.server = { to } as any;

      gateway.notificarActualizacionPedido('p-1', { estado: 'EN_CAMINO' });

      expect(to).toHaveBeenCalledWith('pedido:p-1');
      expect(to).not.toHaveBeenCalledWith('staff');
    });
  });
});
