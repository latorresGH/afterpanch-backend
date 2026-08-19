import { CookieOptions } from 'express';
import ms from 'ms';

export const AUTH_COOKIE_NAME = 'afterpanch_token';

/**
 * En producción viaja con domain='.afterpanch.com.ar' (front y back bajo el
 * mismo dominio padre) y secure=true. Fuera de producción (dev/test) no se
 * puede fijar ese domain ni secure=true porque no hay HTTPS ni ese dominio
 * real, así que el cookie no llegaría nunca al navegador/supertest.
 */
function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function getAuthCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    domain: isProd() ? '.afterpanch.com.ar' : undefined,
    path: '/',
  };
}

export function getAuthCookieMaxAge(): number {
  const expr = process.env.JWT_EXPIRES || '10h';
  return ms(expr as ms.StringValue);
}
