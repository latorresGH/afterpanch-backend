import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { Request } from 'express';
import { UsersService } from '../users/users.service';
import { AUTH_COOKIE_NAME } from './auth-cookie.util';

function extractJwtFromCookie(req: Request): string | null {
  const cookies = req?.cookies as Record<string, string> | undefined;
  return cookies?.[AUTH_COOKIE_NAME] ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private usersService: UsersService) {
    super({
      jwtFromRequest: extractJwtFromCookie,
      secretOrKey: process.env.JWT_SECRET || '',
    });
  }

  async validate(payload: any) {
    // ✅ Validar que el usuario siga existiendo y esté activo
    const user = await this.usersService.findOne(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }
    if (!user.activo) {
      throw new UnauthorizedException('Usuario desactivado');
    }

    return {
      sub: user.id,
      role: user.role,
      email: user.email,
      nombre: user.nombre,
    };
  }
}
