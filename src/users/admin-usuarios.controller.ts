import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../auth/roles.decorator';
import { UsersService } from './users.service';
import { ListarUsuariosQueryDto } from './dto/listar-usuarios-query.dto';

/**
 * La pantalla de Personal del panel, colgada de /admin igual que el resto del
 * rework (/admin/insumos, /admin/extras, /admin/horario).
 *
 * ADMIN en todo. Acá se ve quién tiene acceso al sistema y con qué permisos:
 * no hay una versión pública ni una para el resto del staff.
 *
 * ⚠️ POR QUÉ NO SE EXTENDIÓ `GET /users`: ese endpoint devuelve un array plano
 * y el panel VIEJO desplegado en Vercel lo consume así (`const { data } =
 * await api.get("/users")` y lo mapea directo). Cambiarle la forma a
 * `{ items, paginacion, conteos }` lo dejaría sin poder listar a nadie hasta
 * que salga el frontend nuevo. Mismo criterio que con `POST /config/:clave` y
 * `GET /aderezos`: el endpoint viejo se queda como está y la pantalla nueva
 * estrena el suyo.
 *
 * Las ESCRITURAS siguen en `/users/:id` (PATCH y DELETE): no cambiaron de
 * forma, solo ganaron las guardas de auto-protección por dentro, así que
 * duplicarlas acá sería tener dos puertas al mismo lugar.
 */
@ApiTags('Usuarios')
@ApiBearerAuth()
@Controller('admin/usuarios')
export class AdminUsuariosController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Listado de personal',
    description:
      'Paginado, filtrado por rol y por estado, y con búsqueda por nombre o email, todo resuelto en Postgres. Incluye los conteos del equipo y el último ingreso de cada uno. Por defecto NO trae a los CLIENTE, y trae activos e inactivos juntos.',
  })
  listar(@Query() query: ListarUsuariosQueryDto) {
    return this.users.listarStaff({
      rol: query.rol,
      estado: query.estado,
      buscar: query.buscar,
      incluirClientes: query.incluirClientes ?? false,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    });
  }
}
