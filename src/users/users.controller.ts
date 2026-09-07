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

  /**
   * Editar un usuario: nombre, rol, activo y contraseña (reseteo por admin).
   *
   * `req.user.sub` se pasa al service como ACTOR. Sin eso no hay forma de
   * distinguir "desactivar a otro" de "desactivarme a mí mismo", que es la
   * diferencia entre una acción normal y quedarse afuera del panel. El id sale
   * del JWT, nunca del body.
   */
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Request() req: any,
  ) {
    return this.users.update(id, dto, req.user?.sub);
  }

  /**
   * ⚠️ YA NO BORRA. Desactiva.
   *
   * Acá había un `prisma.user.delete()` real. Además de perder el usuario,
   * `Pedido.repartidor` no declara `onDelete`, así que Prisma aplica
   * `SetNull`: borrar a un repartidor ponía `repartidorId = null` en todos sus
   * pedidos históricos, en silencio. Ahora la única acción posible es
   * desactivar, y la fila nunca se va.
   *
   * La RUTA se mantiene porque el panel viejo desplegado la llama; el botón
   * que decía "borrar definitivamente" ahora desactiva, que es lo que en
   * realidad se quería hacer.
   */
  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.users.remove(id, req.user?.sub);
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
