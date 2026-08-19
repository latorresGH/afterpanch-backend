import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';
import { AUTH_COOKIE_NAME } from '../../src/auth/auth-cookie.util';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Login/register ahora setean el JWT en cookie HttpOnly en vez de devolverlo
 * en el body. Los tests e2e necesitan sacar esa cookie del `Set-Cookie` de
 * la respuesta para poder reenviarla en los requests siguientes.
 */
export function extractAuthCookie(response: {
  headers: Record<string, unknown>;
}): string {
  const setCookie = response.headers['set-cookie'] as string[] | undefined;
  const cookie = setCookie?.find((c) => c.startsWith(`${AUTH_COOKIE_NAME}=`));

  if (!cookie) {
    throw new Error(
      `No se encontró la cookie "${AUTH_COOKIE_NAME}" en la respuesta`,
    );
  }

  return cookie.split(';')[0];
}

/**
 * POST /auth/register fuerza role=CLIENTE siempre (a propósito, no es un
 * bug) y POST /auth/create-user exige estar ya logueado como ADMIN. No hay
 * forma de conseguir el primer ADMIN de un test por HTTP — igual que en
 * producción, donde el primer ADMIN sale del seed de Prisma
 * (prisma/seed.ts), acá lo insertamos directo en la DB.
 *
 * Para no depender de un admin "de bootstrap" en los fixtures de negocio,
 * ese admin insertado a mano se usa solo una vez, para crear -vía
 * POST /auth/create-user, como en producción- el ADMIN real que el test
 * va a usar. Devuelve la cookie de sesión de ESE admin.
 */
export async function createAdminCookie(
  app: INestApplication,
): Promise<string> {
  const prisma = app.get(PrismaService);
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const bootstrapEmail = `bootstrap-${unique}@test.internal`;
  const bootstrapPassword = 'Bootstrap123!';

  await prisma.user.create({
    data: {
      email: bootstrapEmail,
      password: await bcrypt.hash(bootstrapPassword, 10),
      nombre: 'Bootstrap Admin (test)',
      role: Role.ADMIN,
    },
  });

  const bootstrapLogin = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email: bootstrapEmail, password: bootstrapPassword })
    .expect(201);

  const bootstrapCookie = extractAuthCookie(bootstrapLogin);

  const adminEmail = `admin-${unique}@test.internal`;
  const adminPassword = 'AdminTest123!';

  await request(app.getHttpServer())
    .post('/auth/create-user')
    .set('Cookie', bootstrapCookie)
    .send({
      email: adminEmail,
      password: adminPassword,
      nombre: 'Admin Test',
      role: Role.ADMIN,
    })
    .expect(201);

  const adminLogin = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email: adminEmail, password: adminPassword })
    .expect(201);

  return extractAuthCookie(adminLogin);
}
