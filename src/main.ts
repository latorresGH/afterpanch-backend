import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';

process.env.TZ = 'America/Argentina/Buenos_Aires';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());

  // ✅ CORS restringido
  // Con auth por cookie HttpOnly, `credentials: true` es obligatorio (ya
  // estaba) y FRONTEND_URL en producción debe apuntar exacto al origin del
  // front (https://afterpanch.com.ar) para que el navegador acepte el
  // Set-Cookie de respuesta cross-origin.
  app.enableCors({
    origin: (origin, callback) => {
      const allowedOrigins = [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        ...(process.env.FRONTEND_URL
          ? process.env.FRONTEND_URL.split(',').map((s) => s.trim())
          : []),
      ];

      // permitir requests sin origin (postman, curl, healthchecks)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.log('❌ CORS bloqueado para:', origin);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // ✅ Swagger solo en desarrollo
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Afterpanch API')
      .setDescription(
        'API para gestión de pedidos de comida rápida. Incluye control de stock, ofertas, caja y delivery.',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);
  }

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`🚀 Servidor corriendo en http://localhost:${port}`);
  console.log(`📚 Swagger disponible en http://localhost:${port}/api`);
  console.log(`¡Hi! -`);
}
bootstrap();
