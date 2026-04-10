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

  async register(email: string, password: string, nombre: string, role?: Role) {
    const normalized = this.normalizeEmail(email);
    if (!normalized) throw new BadRequestException('Email inválido');
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
    const access_token = await this.jwt.signAsync(payload);

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

    const payload = {
      sub: user.id,
      role: user.role,
      email: user.email,
      nombre: user.nombre,
    };

    return {
      access_token: await this.jwt.signAsync(payload),
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        role: user.role,
      },
    };
  }
}
