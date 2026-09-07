import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { PrismaClient, Role } from '@prisma/client';
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
 * Los emails que ESTA corrida creó. Se borran en el `afterAll` de abajo.
 *
 * Se guardan los emails concretos y no un patrón: la limpieza tiene que
 * llevarse exactamente lo que este helper creó, y nada más. Un
 * `DELETE ... LIKE '%@test.internal'` funcionaría hoy, pero es la clase de
 * borrado amplio que un día se lleva puesto algo que no era suyo.
 */
const creadosPorEsteHelper: string[] = [];

/**
 * ⚠️ LIMPIEZA. Sin esto, cada corrida de e2e dejaba DOS ADMIN activos en la
 * base, para siempre: el bootstrap y el admin real. Se acumularon 54 —27
 * corridas— antes de que alguien lo notara, y no es solo ruido en la tabla:
 * son 54 accesos de administrador vivos, y hacían que la pantalla de Personal
 * mostrara una lista de 55 usuarios de los cuales uno solo era real.
 *
 * Va como `afterAll` a nivel de módulo: se registra al importar el helper, así
 * que aplica a cualquier archivo que lo use sin que cada spec tenga que
 * acordarse de limpiar. Los tres e2e que lo consumen (caja, pedidos, stock) no
 * necesitaron cambios.
 *
 * Usa su PROPIA conexión y no el `PrismaService` del app: el spec cierra el
 * app en su propio `afterAll`, y depender del orden entre dos hooks del mismo
 * scope sería apoyar la limpieza en un detalle de Jest. Con conexión propia el
 * borrado corre igual, haya cerrado el app o no.
 */
afterAll(async () => {
  if (creadosPorEsteHelper.length === 0) return;

  // ⚠️ `PrismaClient` va importado ARRIBA, no con un `await import()` dinámico:
  // Jest corre estos specs como CommonJS y un import dinámico revienta con
  // "A dynamic import callback was invoked without --experimental-vm-modules".
  // El fallo además no aparecía en el resumen de tests —salía como "Test suite
  // failed to run" aparte— así que la limpieza fallaba en silencio.
  const prisma = new PrismaClient();
  try {
    await prisma.user.deleteMany({
      where: { email: { in: creadosPorEsteHelper } },
    });
  } catch (error) {
    // Que la limpieza falle no puede hacer fallar la suite, pero tampoco puede
    // pasar desapercibida: eso fue lo que dejó acumular 54 admins.
    console.warn('[auth-cookie] no se pudieron borrar los usuarios de test:', error);
  } finally {
    creadosPorEsteHelper.length = 0;
    await prisma.$disconnect();
  }
});

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
 *
 * Los dos usuarios que crea quedan anotados para que el `afterAll` de arriba
 * los borre al terminar el archivo. Cómo se arma la sesión no cambió.
 */
export async function createAdminCookie(
  app: INestApplication,
): Promise<string> {
  const prisma = app.get(PrismaService);
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const bootstrapEmail = `bootstrap-${unique}@test.internal`;
  const bootstrapPassword = 'Bootstrap123!';
  creadosPorEsteHelper.push(bootstrapEmail);

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
  creadosPorEsteHelper.push(adminEmail);

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
