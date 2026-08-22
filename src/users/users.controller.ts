import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Request,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Roles } from 'src/auth/roles.decorator';
import { Role } from '@prisma/client';
import { Public } from 'src/auth/public.decorator';

@Roles(Role.ADMIN)
@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  /**
   * Marca visto el splash de bienvenida del Home admin.
   *
   * Va ANTES de @Get(':id')/@Patch(':id') por el orden de resolución de rutas
   * de Nest. El id sale del JWT, nunca del body: cada uno solo puede marcar el
   * suyo. Sobreescribe el @Roles(ADMIN) del controller porque el splash
   * podría mostrarse a cualquier rol autenticado más adelante.
   */
  @Post('me/bienvenida-vista')
  @Roles(Role.ADMIN, Role.TRABAJADOR, Role.DELIVERY, Role.CLIENTE)
  @HttpCode(200)
  marcarBienvenidaVista(@Request() req: any) {
    return this.users.marcarBienvenidaVista(req.user.sub);
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Get()
  findAll() {
    return this.users.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.users.remove(id);
  }

  @Get('repartidores/disponibles')
  @Public()
  async repartidoresDisponibles() {
    const repartidores = await this.users.findByRole(Role.DELIVERY);
    const activos = repartidores.filter((r) => r.activo);

    const resultado = await Promise.all(
      activos.map(async (r) => {
        const pedidosEnCamino = await this.users.contarPedidosEnCamino(r.id);
        return {
          id: r.id,
          nombre: r.nombre,
          email: r.email,
          activo: r.activo,
          pedidosEnCamino,
          disponible: pedidosEnCamino === 0,
        };
      }),
    );

    return resultado;
  }
}
