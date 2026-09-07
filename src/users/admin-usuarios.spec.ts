import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from '@prisma/client';

import { UsersService } from './users.service';
import { AdminUsuariosController } from './admin-usuarios.controller';
import { UsersController } from './users.controller';
import {
  EstadoUsuario,
  ListarUsuariosQueryDto,
} from './dto/listar-usuarios-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { ROLES_KEY } from '../auth/roles.decorator';

const STAFF = [Role.ADMIN, Role.TRABAJADOR, Role.DELIVERY];

describe('UsersService.listarStaff', () => {
  let service: UsersService;
  let findMany: jest.Mock;
  let count: jest.Mock;
  let groupBy: jest.Mock;

  beforeEach(async () => {
    findMany = jest.fn().mockResolvedValue([]);
    count = jest.fn().mockResolvedValue(0);
    groupBy = jest.fn().mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: { user: { findMany, count, groupBy } },
        },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  const listar = (opciones: Partial<Parameters<UsersService['listarStaff']>[0]> = {}) =>
    service.listarStaff({ page: 1, pageSize: 20, ...opciones });

  const where = () => findMany.mock.calls[0][0].where;

  it('⚠️ por defecto EXCLUYE a los CLIENTE', async () => {
    // Es el origen de la lista inflada del panel viejo: `findAll()` traía todos
    // los roles, y la mayoría de las filas son cuentas creadas desde el menú
    // público, que no son personal del local.
    await listar();

    expect(where().role).toEqual({ in: STAFF });
  });

  it('los incluye si se lo pide explícitamente', async () => {
    await listar({ incluirClientes: true });

    expect(where().role.in).toContain(Role.CLIENTE);
  });

  it('un rol puntual gana sobre el default', async () => {
    await listar({ rol: Role.DELIVERY });

    expect(where().role).toEqual({ in: [Role.DELIVERY] });
  });

  describe('filtro por estado', () => {
    it('sin estado NO filtra por activo: es el comportamiento de siempre', async () => {
      // El default es TODOS justamente para no esconder de golpe a los
      // desactivados de una lista donde hasta ayer aparecían.
      await listar();
      expect(where().activo).toBeUndefined();
    });

    it('TODOS explícito tampoco filtra', async () => {
      await listar({ estado: EstadoUsuario.TODOS });
      expect(where().activo).toBeUndefined();
    });

    it('ACTIVOS trae solo los que pueden entrar', async () => {
      await listar({ estado: EstadoUsuario.ACTIVOS });
      expect(where().activo).toBe(true);
    });

    it('INACTIVOS trae solo los desactivados', async () => {
      await listar({ estado: EstadoUsuario.INACTIVOS });
      expect(where().activo).toBe(false);
    });

    it('se combina con el rol y con la busqueda', async () => {
      await listar({
        estado: EstadoUsuario.INACTIVOS,
        rol: Role.TRABAJADOR,
        buscar: 'maxi',
      });

      expect(where()).toMatchObject({
        activo: false,
        role: { in: [Role.TRABAJADOR] },
      });
      expect(where().OR).toBeDefined();
    });

    it('los conteos NO lo respetan: describen al equipo, no a la vista', async () => {
      // Mirando solo los inactivos, "2 con acceso total" sigue siendo la
      // verdad sobre el equipo; un 0 ahi seria alarmante y falso.
      await listar({ estado: EstadoUsuario.INACTIVOS });
      expect(groupBy.mock.calls[0][0].where.activo).toBeUndefined();
    });
  });

  it('busca en nombre Y email, sin distinguir mayúsculas', async () => {
    await listar({ buscar: 'sofi' });

    expect(where().OR).toEqual([
      { nombre: { contains: 'sofi', mode: 'insensitive' } },
      { email: { contains: 'sofi', mode: 'insensitive' } },
    ]);
  });

  it('sin búsqueda no arma un OR vacío', async () => {
    await listar();
    expect(where().OR).toBeUndefined();
  });

  it('pagina en Postgres, no en memoria', async () => {
    await listar({ page: 3, pageSize: 15 });

    expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 30, take: 15 });
  });

  it('ordena activos primero y después por nombre', async () => {
    await listar();

    expect(findMany.mock.calls[0][0].orderBy).toEqual([
      { activo: 'desc' },
      { nombre: 'asc' },
    ]);
  });

  it('nunca devuelve el hash de la contraseña', async () => {
    await listar();

    expect(findMany.mock.calls[0][0].select.password).toBeUndefined();
    expect(findMany.mock.calls[0][0].select.lastLoginAt).toBe(true);
  });

  it('los conteos describen al EQUIPO, no al resultado de la búsqueda', async () => {
    await listar({ buscar: 'zzz' });

    // El findMany filtra por la búsqueda; el groupBy solo por el universo de
    // roles. Si el groupBy la respetara, buscar "zzz" mostraría "0 admins".
    expect(groupBy.mock.calls[0][0].where).toEqual({ role: { in: STAFF } });
  });

  it('arma los conteos por rol y estado', async () => {
    groupBy.mockResolvedValue([
      { role: Role.ADMIN, activo: true, _count: { _all: 2 } },
      { role: Role.ADMIN, activo: false, _count: { _all: 1 } },
      { role: Role.TRABAJADOR, activo: true, _count: { _all: 4 } },
      { role: Role.DELIVERY, activo: false, _count: { _all: 3 } },
    ]);
    count.mockResolvedValue(10);

    const res = await listar();

    expect(res.conteos).toMatchObject({
      total: 10,
      activos: 6,
      inactivos: 4,
      admins: 3,
      adminsActivos: 2,
      trabajadores: 4,
      delivery: 3,
    });
  });

  it('calcula la paginación, con al menos una página aunque no haya nadie', async () => {
    count.mockResolvedValue(0);
    await expect(listar()).resolves.toMatchObject({
      paginacion: { page: 1, pageSize: 20, total: 0, totalPaginas: 1 },
    });

    count.mockResolvedValue(41);
    await expect(listar({ pageSize: 20 })).resolves.toMatchObject({
      paginacion: { total: 41, totalPaginas: 3 },
    });
  });
});

describe('UsersService.marcarLogin', () => {
  let service: UsersService;
  let update: jest.Mock;

  beforeEach(async () => {
    update = jest.fn().mockResolvedValue({ id: 'u1', lastLoginAt: new Date() });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: { user: { update } } },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  it('sella la fecha del login', async () => {
    await service.marcarLogin('u1');

    const args = update.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'u1' });
    expect(args.data.lastLoginAt).toBeInstanceOf(Date);
  });

  it('no toca ningún otro campo', async () => {
    await service.marcarLogin('u1');

    expect(Object.keys(update.mock.calls[0][0].data)).toEqual(['lastLoginAt']);
  });
});

describe('Usuarios admin — rutas, permisos y validación', () => {
  const proto = AdminUsuariosController.prototype;
  const roles = (metodo: any) => Reflect.getMetadata(ROLES_KEY, metodo);
  const esPublico = (metodo: any) =>
    Reflect.getMetadata(IS_PUBLIC_KEY, metodo) === true;

  async function errores(dto: object): Promise<string[]> {
    const fallas = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return fallas.flatMap((f) => Object.values(f.constraints ?? {}));
  }

  describe('rutas y permisos', () => {
    it('cuelga de /admin/usuarios', () => {
      expect(Reflect.getMetadata('path', AdminUsuariosController)).toBe(
        'admin/usuarios',
      );
    });

    it('no es público y es solo ADMIN', () => {
      expect(esPublico(proto.listar)).toBe(false);
      expect(roles(proto.listar)).toEqual([Role.ADMIN]);
    });

    it('las escrituras siguen en /users, no se duplicaron acá', () => {
      // Tener dos puertas al mismo update es la forma de que una se olvide de
      // las guardas.
      expect(Object.getOwnPropertyNames(proto)).toEqual(['constructor', 'listar']);
      expect(UsersController.prototype.update).toBeDefined();
      expect(UsersController.prototype.remove).toBeDefined();
    });
  });

  describe('ListarUsuariosQueryDto', () => {
    it('acepta vacío: la pantalla arranca sin filtros', async () => {
      expect(
        await errores(plainToInstance(ListarUsuariosQueryDto, {})),
      ).toEqual([]);
    });

    it('acepta los tres estados', async () => {
      for (const estado of ['TODOS', 'ACTIVOS', 'INACTIVOS']) {
        expect(
          await errores(plainToInstance(ListarUsuariosQueryDto, { estado })),
        ).toEqual([]);
      }
    });

    it('rechaza un estado inventado', async () => {
      const msgs = await errores(
        plainToInstance(ListarUsuariosQueryDto, { estado: 'PAUSADOS' }),
      );
      expect(msgs.some((m) => m.includes('estado debe ser uno de'))).toBe(true);
    });

    it('rechaza un rol que no existe', async () => {
      const msgs = await errores(
        plainToInstance(ListarUsuariosQueryDto, { rol: 'DUEÑO' }),
      );
      expect(msgs.some((m) => m.includes('rol debe ser uno de'))).toBe(true);
    });

    it('⚠️ clampea pageSize: sin tope vuelve a ser el findAll sin paginar', async () => {
      const msgs = await errores(
        plainToInstance(ListarUsuariosQueryDto, { pageSize: 999999 }),
      );
      expect(msgs.some((m) => m.includes('pageSize no puede pasar de 100'))).toBe(
        true,
      );
    });

    it('rechaza page 0 o negativa', async () => {
      for (const page of [0, -3]) {
        const msgs = await errores(
          plainToInstance(ListarUsuariosQueryDto, { page }),
        );
        expect(msgs.some((m) => m.includes('page arranca en 1'))).toBe(true);
      }
    });

    it('convierte los números que llegan como string en la query', async () => {
      const dto = plainToInstance(ListarUsuariosQueryDto, {
        page: '2',
        pageSize: '50',
      });
      expect(await errores(dto)).toEqual([]);
      expect(dto.page).toBe(2);
      expect(dto.pageSize).toBe(50);
    });

    it('interpreta incluirClientes como booleano', async () => {
      const si = plainToInstance(ListarUsuariosQueryDto, {
        incluirClientes: 'true',
      });
      const no = plainToInstance(ListarUsuariosQueryDto, {
        incluirClientes: 'false',
      });
      expect(si.incluirClientes).toBe(true);
      expect(no.incluirClientes).toBe(false);
    });

    it('recorta la búsqueda', async () => {
      const dto = plainToInstance(ListarUsuariosQueryDto, {
        buscar: '  sofi  ',
      });
      expect(dto.buscar).toBe('sofi');
    });
  });
});
