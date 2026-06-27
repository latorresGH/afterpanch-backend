import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard de autenticación JWT OPCIONAL.
 *
 * A diferencia de JwtAuthGuard, nunca rechaza la request:
 * - Si llega un JWT válido, popula `req.user` (con { sub, role, email, nombre }).
 * - Si no hay token, o es inválido/expirado, deja `req.user` en null y deja pasar igual.
 *
 * Se usa en rutas que deben seguir siendo públicas (ej: POST /pedidos desde el menú
 * anónimo) pero que cambian de comportamiento cuando quien llama es un empleado
 * autenticado (POS/admin).
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any) {
    // No lanzar error si falta el token o es inválido: simplemente no hay usuario.
    return user ?? null;
  }
}
