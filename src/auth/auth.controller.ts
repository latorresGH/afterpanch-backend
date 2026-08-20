import { Body, Controller, Post, Get, Req, Res, HttpCode } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { Roles, ROLES_KEY } from './roles.decorator';
import { Role } from '@prisma/client';
import { Public } from './public.decorator';
import {
  AUTH_COOKIE_NAME,
  getAuthCookieOptions,
  getAuthCookieMaxAge,
} from './auth-cookie.util';

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  private setAuthCookie(res: Response, accessToken: string) {
    res.cookie(AUTH_COOKIE_NAME, accessToken, {
      ...getAuthCookieOptions(),
      maxAge: getAuthCookieMaxAge(),
    });
  }

  @Post('register')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Registrar nuevo cliente',
    description:
      'Crea un nuevo usuario CLIENTE y lo loguea (JWT en cookie HttpOnly). Los roles ADMIN/TRABAJADOR requieren autenticación.',
  })
  @ApiResponse({ status: 201, description: 'Usuario registrado exitosamente' })
  @ApiResponse({
    status: 400,
    description: 'Email ya registrado o datos inválidos',
  })
  @ApiResponse({ status: 429, description: 'Demasiadas solicitudes' })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { access_token, user } = await this.auth.register(
      dto.email,
      dto.password,
      dto.nombre,
      'CLIENTE' as Role,
    );
    this.setAuthCookie(res, access_token);
    return { user };
  }

  @Post('login')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Iniciar sesión',
    description: 'Autentica un usuario y setea el JWT en cookie HttpOnly.',
  })
  @ApiResponse({
    status: 200,
    description: 'Login exitoso, setea cookie de sesión',
  })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas' })
  @ApiResponse({ status: 429, description: 'Demasiadas solicitudes' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { access_token, user } = await this.auth.login(
      dto.email,
      dto.password,
    );
    this.setAuthCookie(res, access_token);
    return { user };
  }

  @Post('logout')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cerrar sesión',
    description: 'Limpia la cookie de sesión HttpOnly.',
  })
  @ApiResponse({ status: 200, description: 'Logout exitoso' })
  // Es @Public() a propósito: cerrar sesión no requiere una sesión válida.
  // Cuando estaba detrás del guard, un usuario cuyo token ya no servía (cuenta
  // borrada, token vencido) recibía 401 y clearCookie NUNCA llegaba a correr,
  // así que la cookie sobrevivía en el navegador y quedaba trabado en un loop
  // (login → home del rol → 401 → login...). No expone nada: no recibe input y
  // sólo borra la cookie de quien llama.
  logout(@Res({ passthrough: true }) res: Response) {
    // clearCookie necesita las mismas opciones de domain/path que se usaron
    // al setear la cookie, si no el navegador no la reconoce y no la borra.
    res.clearCookie(AUTH_COOKIE_NAME, getAuthCookieOptions());
    return { message: 'Logout exitoso' };
  }

  @Post('create-user')
  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Crear usuario con rol específico',
    description:
      'Solo ADMIN puede crear usuarios con roles ADMIN, TRABAJADOR o DELIVERY. No afecta la sesión del ADMIN que lo crea.',
  })
  @ApiResponse({ status: 201, description: 'Usuario creado exitosamente' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No autorizado - Solo ADMIN' })
  async createUser(@Body() dto: RegisterDto) {
    // Ojo: NO seteamos cookie acá. Este endpoint lo llama un ADMIN ya
    // logueado para crear a OTRO usuario — si seteáramos la cookie con el
    // token del usuario recién creado, le pisaríamos la sesión al ADMIN que
    // hizo la request. Tampoco devolvemos el access_token en el body: nadie
    // necesita ese token del lado del ADMIN, y exponerlo sería filtrar una
    // credencial de otra cuenta.
    const { user } = await this.auth.register(
      dto.email,
      dto.password,
      dto.nombre,
      dto.role,
    );
    return { user };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener usuario actual' })
  @ApiResponse({ status: 200, description: 'Datos del usuario autenticado' })
  getMe(@Req() req: any) {
    return req.user;
  }
}
