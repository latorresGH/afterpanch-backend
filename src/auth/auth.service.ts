import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwt: JwtService,
  ) {}

  private normalizeEmail(email: string) {
    return (email || '').trim().toLowerCase();
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  async register(email: string, password: string, nombre: string, role?: Role) {
    const normalized = this.normalizeEmail(email);
    if (!normalized || !this.isValidEmail(normalized))
      throw new BadRequestException('Email inválido');
    if (!password || password.length < 6)
      throw new BadRequestException('Password mínimo 6 caracteres');
    if (!nombre || !nombre.trim())
      throw new BadRequestException('Nombre es obligatorio');

    const existente = await this.usersService.findByEmail(normalized);
    if (existente) throw new BadRequestException('El email ya está registrado');

    // Si no mandan role, default TRABAJADOR
    const user = await this.usersService.create({
      email: normalized,
      password: password,
      nombre: nombre.trim(),
      role: role ?? Role.TRABAJADOR,
    });

    // si querés devolver token directo, descomentá esto:
    const payload = {
      sub: user.id,
      role: user.role,
      email: user.email,
      nombre: user.nombre,
    };
    const expiresIn = (process.env.JWT_EXPIRES || '10h') as `${number}h` | `${number}d` | `${number}s` | `${number}m`;
    const access_token = await this.jwt.signAsync(payload, { expiresIn });

    return {
      access_token,
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        role: user.role,
      },
    };

    // si NO querés token en register, devolvé solo user:
    // return { id: user.id, email: user.email, nombre: user.nombre, role: user.role };
  }

  async login(email: string, password: string) {
    const normalized = this.normalizeEmail(email);

    const user = await this.usersService.findByEmail(normalized);
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Último ingreso. Se escribe DESPUÉS de validar las credenciales —solo un
    // login exitoso cuenta— y su fallo no puede tumbar el login: si el UPDATE
    // falla, el usuario igual entra y lo único que se pierde es un dato
    // informativo de la pantalla de Personal.
    //
    // Va acá y no en el guard a propósito: esto es "inicio de sesión", no
    // "última actividad". Con un token de 10hs, el segundo significado
    // escribiría en cada request.
    await this.usersService.marcarLogin(user.id).catch(() => undefined);

    const payload = {
      sub: user.id,
      role: user.role,
      email: user.email,
      nombre: user.nombre,
    };

    return {
      access_token: await this.jwt.signAsync(payload, {
        expiresIn: (process.env.JWT_EXPIRES || '10h') as `${number}h` | `${number}d` | `${number}s` | `${number}m`,
      }),
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        role: user.role,
      },
    };
  }
}
