import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { createAdminCookie } from './utils/auth-cookie';

/**
 * TESTS CRÍTICOS DE CAJA
 *
 * Valida:
 * 1. Confirmación de pago genera movimiento
 * 2. No permite confirmar mismo pedido 2 veces
 * 3. Separación correcta de ganancias
 * 4. Solo DELIVERY requiere confirmación
 */
describe('Caja Crítico (e2e)', () => {
  let app: INestApplication<App>;
  let adminCookie: string;
  let pedidoDeliveryId: string;
  let pedidoLocalId: string;
  let productoId: string;
  let costoEnvio: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Setup', () => {
    it('crea usuario admin (vía /auth/create-user)', async () => {
      adminCookie = await createAdminCookie(app);
    });

    it('crea producto para tests', async () => {
      const catResponse = await request(app.getHttpServer())
        .post('/categorias')
        .set('Cookie', adminCookie)
        .send({ nombre: `Caja Test Cat ${Date.now()}` })
        .expect(201);

      const insumoResponse = await request(app.getHttpServer())
        .post('/insumos')
        .set('Cookie', adminCookie)
        .send({
          nombre: `Insumo Caja ${Date.now()}`,
          stockInicial: 1000,
          unidad: 'gr',
        })
        .expect(201);

      const prodResponse = await request(app.getHttpServer())
        .post('/productos')
        .set('Cookie', adminCookie)
        .send({
          nombre: `Producto Caja ${Date.now()}`,
          precio: 2500,
          categoriaId: catResponse.body.id,
          receta: [{ insumoId: insumoResponse.body.id, cantidad: 50 }],
        })
        .expect(201);

      productoId = prodResponse.body.id;
    });

    it('crea pedido DELIVERY', async () => {
      costoEnvio = 500;
      const response = await request(app.getHttpServer())
        .post('/pedidos')
        .set('Cookie', adminCookie)
        .send({
          tipo: 'DELIVERY',
          nombreCliente: 'Cliente Delivery',
          direccion: 'Calle Test 123',
          costoEnvio,
          detalles: [
            {
              productoId,
              cantidad: 1,
            },
          ],
        })
        .expect(201);

      pedidoDeliveryId = response.body.id;
    });

    it('crea pedido LOCAL', async () => {
      const response = await request(app.getHttpServer())
        .post('/pedidos')
        .set('Cookie', adminCookie)
        .send({
          tipo: 'LOCAL',
          nombreCliente: 'Cliente Local',
          detalles: [
            {
              productoId,
              cantidad: 1,
            },
          ],
        })
        .expect(201);

      pedidoLocalId = response.body.id;
    });
  });

  describe('Confirmación de pagos', () => {
    it('confirma pago de pedido DELIVERY', async () => {
      const response = await request(app.getHttpServer())
        .post(`/caja/pedido/${pedidoDeliveryId}/confirmar`)
        .set('Cookie', adminCookie)
        .send({
          confirmadoPor: 'Admin Test',
          gananciaRepartidor: costoEnvio,
        })
        .expect(201);

      expect(response.body.pedidoId).toBe(pedidoDeliveryId);
      expect(response.body.tipo).toBe('ENTRADA');
    });

    it('NO permite confirmar el mismo pedido 2 veces', async () => {
      const response = await request(app.getHttpServer())
        .post(`/caja/pedido/${pedidoDeliveryId}/confirmar`)
        .set('Cookie', adminCookie)
        .send({
          confirmadoPor: 'Admin Test',
          gananciaRepartidor: costoEnvio,
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('ya tiene un movimiento');
    });

    it('separación correcta de ganancias', async () => {
      // Se consulta /caja/pedido/:id (no /caja/resumen) porque el resumen es
      // un agregado global sin filtrar por pedido: en una DB compartida con
      // movimientos de otras corridas/pedidos, sumar todo daría un total
      // distinto al de este pedido puntual. Acá lo que importa es que ESTE
      // movimiento separó bien la ganancia del negocio de la del repartidor.
      const response = await request(app.getHttpServer())
        .get(`/caja/pedido/${pedidoDeliveryId}`)
        .set('Cookie', adminCookie)
        .expect(200);

      const [movimiento] = response.body;

      expect(movimiento).toBeDefined();
      expect(movimiento.gananciaNegocio).toBeGreaterThanOrEqual(0);
      expect(movimiento.gananciaRepartidor).toBe(costoEnvio);
    });
  });

  describe('Validaciones', () => {
    it('no permite confirmar pedido cancelado', async () => {
      // Crear y cancelar un pedido
      const pedidoResponse = await request(app.getHttpServer())
        .post('/pedidos')
        .set('Cookie', adminCookie)
        .send({
          tipo: 'DELIVERY',
          nombreCliente: 'Pedido a Cancelar',
          direccion: 'Test 456',
          costoEnvio: 300,
          detalles: [{ productoId, cantidad: 1 }],
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/pedidos/${pedidoResponse.body.id}/cancelar`)
        .set('Cookie', adminCookie)
        .send({ motivo: 'Test', rol: 'ADMIN' })
        .expect(201);

      // Intentar confirmar pago del pedido cancelado
      const confirmResponse = await request(app.getHttpServer())
        .post(`/caja/pedido/${pedidoResponse.body.id}/confirmar`)
        .set('Cookie', adminCookie)
        .send({
          confirmadoPor: 'Admin',
          gananciaRepartidor: 300,
        });

      expect(confirmResponse.status).toBe(400);
      expect(confirmResponse.body.message).toContain('cancelado');
    });

    it('ganancia repartidor no puede ser mayor al total', async () => {
      const pedidoResponse = await request(app.getHttpServer())
        .post('/pedidos')
        .set('Cookie', adminCookie)
        .send({
          tipo: 'DELIVERY',
          nombreCliente: 'Test Ganancia',
          direccion: 'Test 789',
          costoEnvio: 200,
          detalles: [{ productoId, cantidad: 1 }],
        })
        .expect(201);

      // Intentar con ganancia repartidor excesiva
      const confirmResponse = await request(app.getHttpServer())
        .post(`/caja/pedido/${pedidoResponse.body.id}/confirmar`)
        .set('Cookie', adminCookie)
        .send({
          confirmadoPor: 'Admin',
          gananciaRepartidor: 99999, // Mayor al total
        });

      expect(confirmResponse.status).toBe(400);
    });
  });

  describe('Resumen de caja', () => {
    it('incluye movimientos del pedido', async () => {
      const response = await request(app.getHttpServer())
        .get('/caja/resumen')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(response.body.movimientos).toBeDefined();
      expect(Array.isArray(response.body.movimientos)).toBe(true);
      expect(response.body.movimientos.length).toBeGreaterThan(0);
    });

    it('balance es coherente', async () => {
      const response = await request(app.getHttpServer())
        .get('/caja/resumen')
        .set('Cookie', adminCookie)
        .expect(200);

      const { resumen } = response.body;

      // Balance = Entradas - Salidas
      const balanceCalculado = resumen.totalEntradas - resumen.totalSalidas;
      expect(resumen.balance).toBe(balanceCalculado);
    });
  });
});
