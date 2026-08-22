import { Test, TestingModule } from '@nestjs/testing';
import { HomeService } from './home.service';
import { CajaService } from '../caja/caja.service';
import { NegocioConfigService } from '../config/config.service';
import { PedidosService } from '../pedidos/pedidos.service';
import { PedidosGateway } from '../pedidos/pedidos.gateway';
import { UsersService } from '../users/users.service';

describe('HomeService — GET /admin/home', () => {
  let service: HomeService;
  let caja: any;
  let config: any;
  let pedidos: any;
  let gateway: any;
  let users: any;

  const CAJA_VACIA = {
    cobrado: 0,
    entradas: 0,
    salidas: 0,
    balance: 0,
    ticketsCerrados: 0,
    ticketPromedio: 0,
  };

  beforeEach(async () => {
    caja = {
      getResumenAgregado: jest.fn().mockResolvedValue({ ...CAJA_VACIA }),
      getMovimientosDelRango: jest.fn().mockResolvedValue([]),
    };
    config = {
      estaAbierto: jest.fn().mockResolvedValue({
        abierto: true,
        horaApertura: '21:00',
        horaCierre: '23:30',
        horaActual: '22:10',
      }),
    };
    pedidos = {
      getPendienteCobro: jest.fn().mockResolvedValue(0),
      listarActivos: jest.fn().mockResolvedValue([]),
      getDeliveryPendientesConfirmar: jest
        .fn()
        .mockResolvedValue({ total: 0, montoTotal: 0, items: [] }),
      getFacturacionPorDia: jest
        .fn()
        .mockResolvedValue({ dias: [], total: 0, max: 0 }),
    };
    gateway = { getStaffConectados: jest.fn().mockResolvedValue(new Set()) };
    users = {
      findByIdOrNull: jest
        .fn()
        .mockResolvedValue({ id: 'u-1', nombre: 'Maxi', bienvenidaVista: false }),
      findStaffOperativo: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HomeService,
        { provide: CajaService, useValue: caja },
        { provide: NegocioConfigService, useValue: config },
        { provide: PedidosService, useValue: pedidos },
        { provide: PedidosGateway, useValue: gateway },
        { provide: UsersService, useValue: users },
      ],
    }).compile();

    service = module.get(HomeService);
  });

  describe('bienvenida', () => {
    it('se muestra si el flag está en false', async () => {
      const { bienvenida } = await service.getHome('u-1');
      expect(bienvenida).toEqual({ mostrar: true, nombre: 'Maxi' });
    });

    it('no se muestra si ya la vio', async () => {
      users.findByIdOrNull.mockResolvedValue({
        id: 'u-1',
        nombre: 'Maxi',
        bienvenidaVista: true,
      });

      const { bienvenida } = await service.getHome('u-1');

      expect(bienvenida.mostrar).toBe(false);
    });

    it('NO marca el flag: eso lo hace el POST al terminar la animación', async () => {
      await service.getHome('u-1');

      // Si este GET marcara, un prefetch de /admin se comería el splash.
      expect(users.marcarBienvenidaVista).toBeUndefined();
      expect(Object.keys(users)).not.toContain('update');
    });
  });

  describe('caja', () => {
    it('calcula el % cobrado sobre lo facturado', async () => {
      caja.getResumenAgregado.mockResolvedValue({
        ...CAJA_VACIA,
        cobrado: 428600,
      });
      pedidos.getPendienteCobro.mockResolvedValue(89950);

      const { caja: bloque } = await service.getHome('u-1');

      // 428600 / (428600 + 89950) = 82.6% -> 83
      expect(bloque.pctCobrado).toBe(83);
      expect(bloque.pendienteCobro).toBe(89950);
    });

    it('no divide por cero cuando no se facturó nada', async () => {
      const { caja: bloque } = await service.getHome('u-1');

      expect(bloque.pctCobrado).toBe(0);
      expect(Number.isNaN(bloque.pctCobrado)).toBe(false);
    });

    it('da 100% cuando no queda nada pendiente', async () => {
      caja.getResumenAgregado.mockResolvedValue({
        ...CAJA_VACIA,
        cobrado: 50000,
      });
      pedidos.getPendienteCobro.mockResolvedValue(0);

      const { caja: bloque } = await service.getHome('u-1');

      expect(bloque.pctCobrado).toBe(100);
    });

    it('pide el rango del día de hoy, no todo el histórico', async () => {
      await service.getHome('u-1');

      const [inicio, fin] = caja.getResumenAgregado.mock.calls[0];
      expect(inicio.getHours()).toBe(0);
      expect(inicio.getMinutes()).toBe(0);
      expect(fin.getHours()).toBe(23);
      expect(fin.getMinutes()).toBe(59);
      // Mismo día calendario.
      expect(inicio.toDateString()).toBe(fin.toDateString());
    });
  });

  describe('pedidosAbiertos', () => {
    it('cuenta los demorados usando el flag que ya viene del server', async () => {
      pedidos.listarActivos.mockResolvedValue([
        { id: 'p-1', demorado: false },
        { id: 'p-2', demorado: true },
        { id: 'p-3', demorado: true },
      ]);

      const { pedidosAbiertos } = await service.getHome('u-1');

      expect(pedidosAbiertos.total).toBe(3);
      expect(pedidosAbiertos.demorados).toBe(2);
    });

    it('reusa GET /pedidos/activos, no una query propia', async () => {
      await service.getHome('u-1');
      expect(pedidos.listarActivos).toHaveBeenCalledTimes(1);
    });
  });

  describe('equipo', () => {
    beforeEach(() => {
      users.findStaffOperativo.mockResolvedValue([
        { id: 'u-1', nombre: 'Maxi', role: 'ADMIN' },
        { id: 'u-2', nombre: 'Diego Ruiz', role: 'TRABAJADOR' },
        { id: 'u-3', nombre: 'Sol Medina', role: 'TRABAJADOR' },
      ]);
    });

    it('marca conectado a quien tiene un socket en la room staff', async () => {
      gateway.getStaffConectados.mockResolvedValue(new Set(['u-1', 'u-3']));

      const { equipo } = await service.getHome('u-1');

      expect(equipo.map((e) => [e.nombre, e.conectado])).toEqual([
        ['Maxi', true],
        ['Diego Ruiz', false],
        ['Sol Medina', true],
      ]);
    });

    it('deriva las iniciales: primera y última palabra del nombre', async () => {
      const { equipo } = await service.getHome('u-1');

      // Ojo: el mockup mostraba "MX" para Maxi, pero eso es un valor elegido a
      // mano del prototipo. Con un solo nombre no hay apellido del que sacar
      // la segunda letra, así que se toman las dos primeras: "MA".
      expect(equipo.map((e) => e.iniciales)).toEqual(['MA', 'DR', 'SM']);
    });

    it('no explota con nombres raros', async () => {
      users.findStaffOperativo.mockResolvedValue([
        { id: 'a', nombre: '', role: 'ADMIN' },
        { id: 'b', nombre: '   ', role: 'ADMIN' },
        { id: 'c', nombre: 'A', role: 'ADMIN' },
        { id: 'd', nombre: 'Ana  Maria  Lopez', role: 'ADMIN' },
      ]);

      const { equipo } = await service.getHome('u-1');

      expect(equipo.map((e) => e.iniciales)).toEqual(['?', '?', 'A', 'AL']);
    });

    it('si la presencia falla, el Home responde igual con todos desconectados', async () => {
      gateway.getStaffConectados.mockResolvedValue(new Set());

      const { equipo } = await service.getHome('u-1');

      expect(equipo).toHaveLength(3);
      expect(equipo.every((e) => e.conectado === false)).toBe(true);
    });
  });

  it('resuelve todos los bloques en paralelo, con una sola pasada por service', async () => {
    const { local, facturacionSemana, movimientosHoy, deliveryPendientesConfirmar } =
      await service.getHome('u-1');

    expect(local.abierto).toBe(true);
    expect(facturacionSemana).toEqual({ dias: [], total: 0, max: 0 });
    expect(movimientosHoy).toEqual([]);
    expect(deliveryPendientesConfirmar.total).toBe(0);

    for (const fn of [
      caja.getResumenAgregado,
      caja.getMovimientosDelRango,
      config.estaAbierto,
      pedidos.getPendienteCobro,
      pedidos.listarActivos,
      pedidos.getDeliveryPendientesConfirmar,
      pedidos.getFacturacionPorDia,
      users.findStaffOperativo,
      gateway.getStaffConectados,
    ]) {
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });
});
