import { Body, Controller, Post, UseGuards, Get, Req } from '@nestjs/common';
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
import { JwtAuthGuard } from './jwt-auth.guard';
import { Roles, ROLES_KEY } from './roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  /**
   * Registro público - SIEMPRE crea rol CLIENTE
   * Rate limit: 5 por minuto para prevenir spam
   */
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Registrar nuevo cliente',
    description:
      'Crea un nuevo usuario CLIENTE. Los roles ADMIN/TRABAJADOR requieren autenticación.',
  })
  @ApiResponse({ status: 201, description: 'Usuario registrado exitosamente' })
  @ApiResponse({
    status: 400,
    description: 'Email ya registrado o datos inválidos',
  })
  @ApiResponse({ status: 429, description: 'Demasiadas solicitudes' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(
      dto.email,
      dto.password,
      dto.nombre,
      'CLIENTE' as Role,
    );
  }

  /**
   * Login
   * Rate limit: 5 por minuto para prevenir fuerza bruta
   */
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Iniciar sesión',
    description: 'Autentica un usuario y devuelve un JWT token.',
  })
  @ApiResponse({
    status: 200,
    description: 'Login exitoso, devuelve token JWT',
  })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas' })
  @ApiResponse({ status: 429, description: 'Demasiadas solicitudes' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  /**
   * Crear usuario con rol específico - Solo ADMIN
   */
  @Post('create-user')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Crear usuario con rol específico',
    description:
      'Solo ADMIN puede crear usuarios con roles ADMIN, TRABAJADOR o DELIVERY.',
  })
  @ApiResponse({ status: 201, description: 'Usuario creado exitosamente' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No autorizado - Solo ADMIN' })
  createUser(@Body() dto: RegisterDto) {
    return this.auth.register(dto.email, dto.password, dto.nombre, dto.role);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener usuario actual' })
  @ApiResponse({ status: 200, description: 'Datos del usuario autenticado' })
  getMe(@Req() req: any) {
    return req.user;
  }
}
