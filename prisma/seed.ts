import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Crea el primer ADMIN cuando la tabla de usuarios está vacía.
 *
 * No hay otro mecanismo de bootstrap en la app: /auth/register siempre
 * fuerza role=CLIENTE (a propósito) y /auth/create-user requiere ya estar
 * logueado como ADMIN. Sin este seed, el único camino era insertar el
 * primer admin a mano en la DB.
 *
 * Seguro de correr más de una vez: si ya hay algún usuario (el admin
 * inicial u otro), no hace nada.
 */
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL no está definida');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const usuariosExistentes = await prisma.user.count();
    if (usuariosExistentes > 0) {
      console.log(
        `ℹ️  Ya hay ${usuariosExistentes} usuario(s) en la base — seed de ADMIN inicial omitido.`,
      );
      return;
    }

    const email = process.env.ADMIN_SEED_EMAIL;
    const password = process.env.ADMIN_SEED_PASSWORD;
    const nombre = process.env.ADMIN_SEED_NOMBRE?.trim() || 'Administrador';

    if (!email || !password) {
      throw new Error(
        'La tabla de usuarios está vacía pero faltan ADMIN_SEED_EMAIL / ' +
          'ADMIN_SEED_PASSWORD. Definilas como variables de entorno para ' +
          'crear el ADMIN inicial (ej: en el .env del deploy, nunca en el código).',
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      throw new Error(`ADMIN_SEED_EMAIL inválido: "${email}"`);
    }
    if (password.length < 6) {
      throw new Error('ADMIN_SEED_PASSWORD debe tener al menos 6 caracteres');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const admin = await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: passwordHash,
        nombre,
        role: Role.ADMIN,
      },
      select: { id: true, email: true, nombre: true, role: true },
    });

    console.log(`✅ ADMIN inicial creado: ${admin.email} (id: ${admin.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(
    '❌ Error en el seed:',
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
