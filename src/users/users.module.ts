import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AdminUsuariosController } from './admin-usuarios.controller';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * Dos controllers sobre el mismo service, como en el resto del rework:
 *
 * - `UsersController`, sobre /users, es lo viejo y las ESCRITURAS. El panel
 *   desplegado lo consume tal cual, así que no cambió de forma; lo que cambió
 *   es lo que pasa por dentro (guardas de auto-protección, y el DELETE que ya
 *   no borra).
 * - `AdminUsuariosController` cuelga de /admin/usuarios y es solo el listado
 *   de la pantalla nueva: paginado, filtrado y con conteos.
 */
@Module({
  controllers: [UsersController, AdminUsuariosController],
  providers: [UsersService, PrismaService],
  exports: [UsersService],
})
export class UsersModule {}
