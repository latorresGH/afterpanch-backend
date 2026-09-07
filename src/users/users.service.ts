import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Prisma, Role } from '@prisma/client';
import { EstadoUsuario } from './dto/listar-usuarios-query.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  private normalizeEmail(email: string) {
    return (email || '').trim().toLowerCase();
  }

  async create(dto: CreateUserDto) {
    const email = this.normalizeEmail(dto.email);

    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new BadRequestException('Email ya registrado');

    const passwordHash = await bcrypt.hash(dto.password, 10);

    return this.prisma.user.create({
      data: {
        email,
        nombre: dto.nombre.trim(),
        password: passwordHash,
        role: dto.role ?? Role.TRABAJADOR,
      },
      select: {
        id: true,
        email: true,
        nombre: true,
        role: true,
        createdAt: true,
      },
    });
  }

  /**
   * ⚠️ LEGACY: todos los usuarios de todos los roles, sin paginar.
   *
   * Lo sirve `GET /users`, que el panel VIEJO desplegado en Vercel todavía
   * consume esperando un array plano. No se cambia de forma —hacerlo lo
   * dejaría sin poder listar nada— pero la pantalla nueva usa
   * `GET /admin/usuarios`, que pagina, filtra y no arrastra a los CLIENTE.
   * Se retira cuando el frontend nuevo esté desplegado.
   */
  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        nombre: true,
        role: true,
        activo: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * El listado de la pantalla de Personal: paginado, filtrado y buscado en
   * Postgres, más los conteos por rol.
   *
   * ⚠️ POR DEFECTO EXCLUYE A LOS CLIENTES. `findAll()` devuelve todos los
   * usuarios de todos los roles sin paginar, y en esta base eso son 47+ filas
   * de las cuales la enorme mayoría son CLIENTE — cuentas creadas por
   * `POST /auth/register` desde el menú público, que no son personal del local
   * y no se administran desde esta pantalla. Ese es el origen de la lista
   * inflada que se veía en el panel viejo.
   *
   * Los conteos se calculan sobre el MISMO universo que el filtro de roles
   * (staff, o el rol pedido), no sobre lo que quedó en la página: describen el
   * equipo, no el resultado de la búsqueda. Por eso tampoco los toca `estado`:
   * mirando solo los inactivos, "2 con acceso total" sigue siendo la verdad
   * sobre el equipo, y un 0 ahí sería alarmante y falso.
   */
  async listarStaff(opciones: {
    rol?: Role;
    estado?: EstadoUsuario;
    buscar?: string;
    incluirClientes?: boolean;
    page: number;
    pageSize: number;
  }) {
    const { rol, estado, buscar, incluirClientes, page, pageSize } = opciones;

    const rolesVisibles = rol
      ? [rol]
      : incluirClientes
        ? [Role.ADMIN, Role.TRABAJADOR, Role.DELIVERY, Role.CLIENTE]
        : [Role.ADMIN, Role.TRABAJADOR, Role.DELIVERY];

    // `undefined` y no un `{}`: Prisma ignora la clave y el WHERE queda como
    // estaba. Es lo que mantiene TODOS igual al comportamiento previo al
    // filtro, sin una rama aparte.
    const filtroActivo =
      estado === EstadoUsuario.ACTIVOS
        ? true
        : estado === EstadoUsuario.INACTIVOS
          ? false
          : undefined;

    const where: Prisma.UserWhereInput = {
      role: { in: rolesVisibles },
      ...(filtroActivo !== undefined ? { activo: filtroActivo } : {}),
      ...(buscar
        ? {
            OR: [
              { nombre: { contains: buscar, mode: 'insensitive' as const } },
              { email: { contains: buscar, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total, porRol] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          nombre: true,
          role: true,
          activo: true,
          lastLoginAt: true,
          createdAt: true,
        },
        // Activos primero, después por nombre: quien trabaja hoy va arriba.
        orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
      // Los conteos ignoran la BÚSQUEDA pero respetan el universo de roles: son
      // el estado del equipo, no el de la consulta.
      this.prisma.user.groupBy({
        by: ['role', 'activo'],
        where: { role: { in: rolesVisibles } },
        _count: { _all: true },
      }),
    ]);

    const contar = (r: Role, activo?: boolean) =>
      porRol
        .filter((g) => g.role === r && (activo === undefined || g.activo === activo))
        .reduce((suma, g) => suma + g._count._all, 0);

    return {
      items,
      paginacion: {
        page,
        pageSize,
        total,
        totalPaginas: Math.max(1, Math.ceil(total / pageSize)),
      },
      conteos: {
        total: porRol.reduce((suma, g) => suma + g._count._all, 0),
        activos: porRol
          .filter((g) => g.activo)
          .reduce((suma, g) => suma + g._count._all, 0),
        inactivos: porRol
          .filter((g) => !g.activo)
          .reduce((suma, g) => suma + g._count._all, 0),
        admins: contar(Role.ADMIN),
        adminsActivos: contar(Role.ADMIN, true),
        trabajadores: contar(Role.TRABAJADOR),
        delivery: contar(Role.DELIVERY),
        // Cuántos nunca entraron: la pregunta que uno se hace antes de
        // desactivar una cuenta vieja.
        nuncaIngresaron: await this.prisma.user.count({
          where: { role: { in: rolesVisibles }, lastLoginAt: null },
        }),
      },
    };
  }

  /**
   * Busca un usuario por id y devuelve `null` si no existe, en vez de tirar.
   *
   * Lo usa el flujo de validación del JWT (`JwtStrategy.validate`): si el
   * usuario del token ya no está en la DB, la respuesta correcta es 401
   * (la sesión no vale) y no 404 (que significa "el recurso que pediste no
   * existe" — pero el recurso pedido era, por ejemplo, /pedidos, no el usuario).
   * Ese 404 dejaba al cliente sin poder reaccionar: el interceptor del frontend
   * solo escucha 401, así que ni siquiera podía desloguearse.
   */
  async findByIdOrNull(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        nombre: true,
        role: true,
        activo: true,
        bienvenidaVista: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * Versión estricta para el panel (GET /users/:id): acá el usuario SÍ es el
   * recurso pedido, así que un 404 es lo correcto.
   */
  async findOne(id: string) {
    const u = await this.findByIdOrNull(id);
    if (!u) throw new NotFoundException('Usuario no encontrado');
    return u;
  }

  // IMPORTANTE: para Auth necesitamos el password, así que este método NO hace select parcial
  async findByEmail(email: string) {
    const normalized = this.normalizeEmail(email);
    return this.prisma.user.findUnique({ where: { email: normalized } });
  }

  /**
   * Marca el splash de bienvenida como visto. Idempotente: si ya estaba en
   * true, el update es un no-op y devuelve lo mismo.
   *
   * Lo llama el frontend cuando TERMINA la animación, no el SSR que la sirve:
   * si lo marcara el GET del Home, un prefetch de /admin consumiría el flag
   * sin que el usuario llegara a ver nada.
   */
  async marcarBienvenidaVista(id: string) {
    await this.ensureExists(id);
    return this.prisma.user.update({
      where: { id },
      data: { bienvenidaVista: true },
      select: { id: true, bienvenidaVista: true },
    });
  }

  /**
   * Sella el último login exitoso.
   *
   * Lo llama `AuthService.login` y su resultado se ignora a propósito: es un
   * dato informativo para la pantalla de Personal, y ninguna falla suya
   * justifica impedirle a alguien entrar al sistema.
   */
  async marcarLogin(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
      select: { id: true, lastLoginAt: true },
    });
  }

  async findByRole(role: Role) {
    return this.prisma.user.findMany({
      where: { role },
      select: {
        id: true,
        email: true,
        nombre: true,
        role: true,
        activo: true,
        createdAt: true,
      },
      orderBy: { nombre: 'asc' },
    });
  }

  /**
   * Staff operativo para el bloque "Equipo" del Home: ADMIN y TRABAJADOR
   * habilitados. DELIVERY queda afuera a propósito (no entra a la room de
   * staff del WebSocket, así que nunca podría figurar como conectado).
   */
  async findStaffOperativo() {
    return this.prisma.user.findMany({
      where: {
        activo: true,
        role: { in: [Role.ADMIN, Role.TRABAJADOR] },
      },
      select: { id: true, nombre: true, role: true },
      orderBy: { nombre: 'asc' },
    });
  }

  async contarPedidosEnCamino(repartidorId: string) {
    return this.prisma.pedido.count({
      where: {
        repartidorId,
        estado: 'EN_CAMINO',
      },
    });
  }

  /**
   * Edición de un usuario, con las guardas que evitan dejar el sistema (o a
   * quien está operando) sin acceso.
   *
   * `actorId` es el `sub` del JWT de quien hace la request. Es opcional en la
   * firma para no romper llamadas internas, pero el controller SIEMPRE lo
   * pasa: sin él, las dos primeras guardas no pueden aplicarse.
   *
   * Las tres cosas que se bloquean, y por qué cada una:
   *
   * 1. DESACTIVARSE A SÍ MISMO. Hoy esto se podía hacer, y el efecto es
   *    inmediato: `JwtStrategy.validate` rechaza a los usuarios inactivos, así
   *    que el siguiente request del propio usuario da 401 y queda afuera de su
   *    panel sin forma de volver a entrar. Nadie quiere hacer esto a
   *    propósito; es un dedazo sobre la tarjeta equivocada.
   *
   * 2. BAJARSE EL PROPIO ROL SIENDO EL ÚLTIMO ADMIN. Mismo efecto que arriba
   *    pero peor: el sistema queda SIN NINGÚN ADMINISTRADOR, y como
   *    `POST /auth/create-user` exige ser ADMIN, no hay forma de crear otro
   *    por HTTP. Se sale de eso tocando la base a mano.
   *
   * 3. DESACTIVAR AL ÚLTIMO ADMIN, sea uno mismo u otro. Es el mismo agujero
   *    que 2 por otra puerta: da igual si el último admin se va por cambio de
   *    rol o por desactivación, el resultado es un sistema sin dueño.
   *
   * Las guardas 2 y 3 miran a los ADMIN **activos**: un admin desactivado no
   * puede entrar, así que no cuenta como salida de emergencia.
   */
  async update(id: string, dto: UpdateUserDto, actorId?: string) {
    const objetivo = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, activo: true, nombre: true },
    });
    if (!objetivo) throw new NotFoundException('Usuario no encontrado');

    const esSuPropiaCuenta = !!actorId && actorId === id;
    const seDesactiva = dto.activo === false && objetivo.activo;
    const cambiaDeRol = dto.role !== undefined && dto.role !== objetivo.role;
    const dejaDeSerAdmin =
      objetivo.role === Role.ADMIN &&
      ((cambiaDeRol && dto.role !== Role.ADMIN) || seDesactiva);

    // 1. Nadie se desactiva a sí mismo.
    if (esSuPropiaCuenta && seDesactiva) {
      throw new BadRequestException(
        'No podés desactivar tu propio acceso. Pedile a otro administrador que lo haga.',
      );
    }

    // 2 y 3. El sistema no se queda sin ningún ADMIN activo.
    if (dejaDeSerAdmin && objetivo.activo) {
      const otrosAdmins = await this.prisma.user.count({
        where: { role: Role.ADMIN, activo: true, id: { not: id } },
      });

      if (otrosAdmins === 0) {
        throw new BadRequestException(
          esSuPropiaCuenta
            ? 'Sos el único administrador activo: si te sacás el rol o te desactivás, nadie puede administrar el sistema. Nombrá a otro administrador primero.'
            : `${objetivo.nombre} es el único administrador activo. Nombrá a otro administrador antes de sacarle el acceso.`,
        );
      }
    }

    const data: any = {};
    if (dto.nombre !== undefined) data.nombre = dto.nombre.trim();
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.activo !== undefined) data.activo = Boolean(dto.activo);

    if (dto.password !== undefined) {
      data.password = await bcrypt.hash(dto.password, 10);
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        nombre: true,
        role: true,
        activo: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * "Eliminar" un acceso = DESACTIVARLO. La fila nunca se borra.
   *
   * ⚠️ Acá había un `prisma.user.delete()` de verdad, y el panel lo ofrecía
   * detrás de un `confirm("¿Borrar definitivamente este acceso?")`. El problema
   * no era solo perder el usuario: `Pedido.repartidor` es una relación opcional
   * SIN `onDelete` explícito, así que Prisma aplica `SetNull` — borrar a un
   * repartidor ponía `repartidorId = null` en TODOS sus pedidos históricos, en
   * silencio y sin ningún error. El historial de quién entregó qué se perdía
   * para siempre, y ni el que apretaba el botón se enteraba.
   *
   * Se conserva la RUTA (`DELETE /users/:id`) para no romper el panel viejo
   * desplegado, que todavía la llama, pero la acción real es la desactivación
   * — que es lo que ese botón quería decir de todos modos. Pasa por `update`,
   * así que hereda las guardas: nadie se borra a sí mismo ni deja el sistema
   * sin ADMIN.
   */
  async remove(id: string, actorId?: string) {
    return this.update(id, { activo: false }, actorId);
  }

  private async ensureExists(id: string) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!u) throw new NotFoundException('Usuario no encontrado');
  }
}
