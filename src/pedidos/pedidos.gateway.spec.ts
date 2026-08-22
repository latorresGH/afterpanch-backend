import { Role } from '@prisma/client';
import {
  PedidosGateway,
  WS_JOIN_ERROR,
  construirOrigenesPermitidos,
  origenPermitido,
} from './pedidos.gateway';

const FRONTEND_URL_ORIGINAL = process.env.FRONTEND_URL;

/**
 * Socket falso con lo mínimo que toca el gateway. Guarda lo emitido y las
 * rooms para poder asertar sobre eso.
 */
function socketFalso(opts: { origin?: string; cookie?: string } = {}) {
  const emitidos: Array<{ evento: string; payload: any }> = [];
  const rooms: string[] = [];
  return {
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

describe('PedidosGateway — auth por cookie en el handshake', () => {
  let gateway: PedidosGateway;
  let jwtService: { verifyAsync: jest.Mock };
  let jwtStrategy: { validate: jest.Mock };
  let prisma: { pedido: { findUnique: jest.Mock } };

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
  });

  afterAll(() => {
    process.env.FRONTEND_URL = FRONTEND_URL_ORIGINAL;
  });

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
  describe('handleConnection', () => {
    it('desconecta si el origin no está permitido', async () => {
      const client = socketFalso({ origin: 'https://sitio-malicioso.com' });

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('resuelve el usuario desde la cookie del handshake', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'u-1' });
      jwtStrategy.validate.mockResolvedValue(USUARIO_ADMIN);

      const client = socketFalso({
        origin: 'https://www.afterpanch.com.ar',
        cookie: 'otra=x; afterpanch_token=jwt-valido; mas=y',
      });

      await gateway.handleConnection(client);

      // Parseó el header crudo y extrajo SOLO la cookie de auth.
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('jwt-valido');
      // Revalidó contra DB con la misma lógica que las rutas HTTP.
      expect(jwtStrategy.validate).toHaveBeenCalledWith({ sub: 'u-1' });
      expect(client.data.user).toEqual(USUARIO_ADMIN);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('conecta SIN usuario si no hay cookie (tracking público)', async () => {
      const client = socketFalso({ origin: 'https://www.afterpanch.com.ar' });

      await gateway.handleConnection(client);

      expect(client.data.user).toBeNull();
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('conecta SIN usuario si el JWT es inválido, sin tirar', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

      const client = socketFalso({
        origin: 'https://www.afterpanch.com.ar',
        cookie: 'afterpanch_token=vencido',
      });

      await expect(gateway.handleConnection(client)).resolves.toBeUndefined();
      expect(client.data.user).toBeNull();
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('conecta SIN usuario si el usuario fue desactivado o borrado', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'u-1' });
      jwtStrategy.validate.mockRejectedValue(new Error('Usuario desactivado'));

      const client = socketFalso({
        origin: 'https://www.afterpanch.com.ar',
        cookie: 'afterpanch_token=firma-ok-pero-usuario-inactivo',
      });

      await gateway.handleConnection(client);

      expect(client.data.user).toBeNull();
    });

    it('ignora un header de cookies sin la cookie de auth', async () => {
      const client = socketFalso({
        origin: 'https://www.afterpanch.com.ar',
        cookie: 'analytics=abc; theme=dark',
      });

      await gateway.handleConnection(client);

      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
      expect(client.data.user).toBeNull();
    });
  });

  // ----------------------------------------------------------------------
  describe('join-staff', () => {
    async function conectarComo(role: Role) {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'u-1' });
      jwtStrategy.validate.mockResolvedValue({ ...USUARIO_ADMIN, role });
      const client = socketFalso({
        origin: 'https://www.afterpanch.com.ar',
        cookie: 'afterpanch_token=jwt-valido',
      });
      await gateway.handleConnection(client);
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
      const client = socketFalso({ origin: 'https://www.afterpanch.com.ar' });
      await gateway.handleConnection(client);

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
      const client = socketFalso({ origin: 'https://www.afterpanch.com.ar' });
      await gateway.handleConnection(client);

      // Aunque el cliente mandara el token viejo, no debe servirle de nada.
      (gateway.handleJoinStaff as any)(client, { token: 'jwt-de-admin' });

      expect(client.rooms).not.toContain('staff');
      expect(client.emitidos[0].payload.code).toBe(
        WS_JOIN_ERROR.SESION_INVALIDA,
      );
    });

    it('re-autentica sola tras una reconexión (handshake nuevo)', async () => {
      // Caída de red: socket.io reconecta y rehace el handshake, así que el
      // usuario se resuelve otra vez desde la cookie, sin intervención.
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
        origin: 'https://www.afterpanch.com.ar',
        cookie: 'afterpanch_token=vencido',
      });
      await gateway.handleConnection(client);

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
      const client = socketFalso({ origin: 'https://www.afterpanch.com.ar' });
      await gateway.handleConnection(client);
      expect(client.data.user).toBeNull(); // anónimo, a propósito

      await gateway.handleJoinPedido(client, { id: 'p-1', code: 'abc123' });

      expect(client.rooms).toContain('pedido:p-1');
    });

    it('rechaza si el code no coincide', async () => {
      prisma.pedido.findUnique.mockResolvedValue({ trackingCode: 'abc123' });
      const client = socketFalso({ origin: 'https://www.afterpanch.com.ar' });
      await gateway.handleConnection(client);

      await gateway.handleJoinPedido(client, { id: 'p-1', code: 'incorrecto' });

      expect(client.rooms).not.toContain('pedido:p-1');
      expect(client.emitidos[0].payload.message).toBe('Acceso denegado');
    });

    it('exige id', async () => {
      const client = socketFalso({ origin: 'https://www.afterpanch.com.ar' });
      await gateway.handleConnection(client);

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
        fetchSockets: jest.fn().mockResolvedValue([
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
          fetchSockets: jest.fn().mockResolvedValue([
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
          fetchSockets: jest.fn().mockResolvedValue([
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
