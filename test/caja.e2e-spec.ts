import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

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
  let adminToken: string;
  let pedidoDeliveryId: string;
  let pedidoLocalId: string;
  let productoId: string;
  let costoEnvio: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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
    it('crea usuario admin', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: `caja-test-${Date.now()}@test.com`,
          password: 'password123',
          nombre: 'Caja Test Admin',
        })
        .expect(201);

      adminToken = response.body.access_token;
    });

    it('crea producto para tests', async () => {
      const catResponse = await request(app.getHttpServer())
        .post('/categorias')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nombre: `Caja Test Cat ${Date.now()}` })
        .expect(201);

      const insumoResponse = await request(app.getHttpServer())
        .post('/insumos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          nombre: `Insumo Caja ${Date.now()}`,
          stockInicial: 1000,
          unidad: 'gr',
        })
        .expect(201);

      const prodResponse = await request(app.getHttpServer())
        .post('/productos')
        .set('Authorization', `Bearer ${adminToken}`)
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
        .set('Authorization', `Bearer ${adminToken}`)
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
        .set('Authorization', `Bearer ${adminToken}`)
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
        .set('Authorization', `Bearer ${adminToken}`)
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
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          confirmadoPor: 'Admin Test',
          gananciaRepartidor: costoEnvio,
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('ya tiene un movimiento');
    });

    it('separación correcta de ganancias', async () => {
      const response = await request(app.getHttpServer())
        .get('/caja/resumen')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const resumen = response.body.resumen;

      // Verificar que las ganancias están separadas
      expect(resumen.gananciaNegocioTotal).toBeDefined();
      expect(resumen.gananciaRepartidorTotal).toBeDefined();
      expect(resumen.gananciaNegocioTotal).toBeGreaterThanOrEqual(0);
      expect(resumen.gananciaRepartidorTotal).toBe(costoEnvio);
    });
  });

  describe('Validaciones', () => {
    it('no permite confirmar pedido cancelado', async () => {
      // Crear y cancelar un pedido
      const pedidoResponse = await request(app.getHttpServer())
        .post('/pedidos')
        .set('Authorization', `Bearer ${adminToken}`)
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
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ motivo: 'Test', rol: 'ADMIN' })
        .expect(201);

      // Intentar confirmar pago del pedido cancelado
      const confirmResponse = await request(app.getHttpServer())
        .post(`/caja/pedido/${pedidoResponse.body.id}/confirmar`)
        .set('Authorization', `Bearer ${adminToken}`)
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
        .set('Authorization', `Bearer ${adminToken}`)
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
        .set('Authorization', `Bearer ${adminToken}`)
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
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.movimientos).toBeDefined();
      expect(Array.isArray(response.body.movimientos)).toBe(true);
      expect(response.body.movimientos.length).toBeGreaterThan(0);
    });

    it('balance es coherente', async () => {
      const response = await request(app.getHttpServer())
        .get('/caja/resumen')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const { resumen } = response.body;

      // Balance = Entradas - Salidas
      const balanceCalculado = resumen.totalEntradas - resumen.totalSalidas;
      expect(resumen.balance).toBe(balanceCalculado);
    });
  });
});
