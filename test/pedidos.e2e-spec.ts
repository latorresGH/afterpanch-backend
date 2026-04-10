import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

describe('Pedidos (e2e)', () => {
  let app: INestApplication<App>;
  let authToken: string;
  let productoId: string;
  let categoriaId: string;
  let extraId: string;
  let aderezoId: string;
  let insumoId: string;

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

  describe('Setup inicial', () => {
    it('debe registrar un usuario admin', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: `test-admin-${Date.now()}@test.com`,
          password: 'password123',
          nombre: 'Test Admin',
          role: 'ADMIN',
        })
        .expect(201);

      authToken = response.body.access_token;
      expect(authToken).toBeDefined();
    });

    it('debe crear una categoria', async () => {
      const response = await request(app.getHttpServer())
        .post('/categorias')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          nombre: `Hamburguesas Test ${Date.now()}`,
          descripcion: 'Categoria de prueba',
        })
        .expect(201);

      categoriaId = response.body.id;
    });

    it('debe crear un insumo', async () => {
      const response = await request(app.getHttpServer())
        .post('/insumos')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          nombre: `Carne Test ${Date.now()}`,
          stockInicial: 1000,
          unidad: 'gr',
        })
        .expect(201);

      insumoId = response.body.id;
    });

    it('debe crear un producto con receta', async () => {
      const response = await request(app.getHttpServer())
        .post('/productos')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          nombre: `Hamburguesa Test ${Date.now()}`,
          precio: 1500,
          categoriaId: categoriaId,
          receta: [{ insumoId: insumoId, cantidad: 100 }],
        })
        .expect(201);

      productoId = response.body.id;
    });

    it('debe crear un extra con stock', async () => {
      const response = await request(app.getHttpServer())
        .post('/extras')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          nombre: `Queso Extra Test ${Date.now()}`,
          precio: 200,
          stockActual: 100,
          categoria: 'ADEREZOS',
        })
        .expect(201);

      extraId = response.body.id;
    });

    it('debe crear un aderezo', async () => {
      const response = await request(app.getHttpServer())
        .post('/aderezos')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          nombre: `Ketchup Test ${Date.now()}`,
        })
        .expect(201);

      aderezoId = response.body.id;
    });
  });

  describe('Logica de pedidos - SIN AUTENTICACION (endpoint publico)', () => {
    it('NO debe limitar aderezos a 2 - debe aceptar mas de 2 aderezos', async () => {
      const response = await request(app.getHttpServer())
        .post('/pedidos')
        .send({
          tipo: 'LOCAL',
          nombreCliente: 'Cliente Test',
          detalles: [
            {
              productoId: productoId,
              cantidad: 1,
              aderezosIds: [
                aderezoId,
                aderezoId,
                aderezoId,
                aderezoId,
                aderezoId,
              ],
            },
          ],
        });

      expect(response.status).toBe(201);
      expect(response.body.detalles).toBeDefined();
      expect(response.body.total).toBe(1500);
    });

    it('debe cobrar extras a partir del tercero', async () => {
      const response = await request(app.getHttpServer())
        .post('/pedidos')
        .send({
          tipo: 'LOCAL',
          nombreCliente: 'Cliente Extras Test',
          detalles: [
            {
              productoId: productoId,
              cantidad: 1,
              extras: [
                { extraId: extraId, cantidad: 1 },
                { extraId: extraId, cantidad: 1 },
                { extraId: extraId, cantidad: 1 },
                { extraId: extraId, cantidad: 1 },
                { extraId: extraId, cantidad: 1 },
              ],
            },
          ],
        });

      expect(response.status).toBe(201);
      expect(response.body.total).toBeDefined();
      expect(response.body.total).toBe(1500 + 200 * 3);
    });

    it('NO debe cobrar los primeros 2 extras', async () => {
      const response = await request(app.getHttpServer())
        .post('/pedidos')
        .send({
          tipo: 'LOCAL',
          nombreCliente: 'Cliente Gratis Test',
          detalles: [
            {
              productoId: productoId,
              cantidad: 1,
              extras: [
                { extraId: extraId, cantidad: 1 },
                { extraId: extraId, cantidad: 1 },
              ],
            },
          ],
        });

      expect(response.status).toBe(201);
      expect(response.body.total).toBe(1500);
    });

    it('los aderezos NO deben afectar el precio', async () => {
      const response = await request(app.getHttpServer())
        .post('/pedidos')
        .send({
          tipo: 'LOCAL',
          nombreCliente: 'Cliente Aderezos Test',
          detalles: [
            {
              productoId: productoId,
              cantidad: 1,
              aderezosIds: [aderezoId, aderezoId, aderezoId],
            },
          ],
        });

      expect(response.status).toBe(201);
      expect(response.body.total).toBe(1500);
    });

    it('sinExtras debe funcionar correctamente', async () => {
      const response = await request(app.getHttpServer())
        .post('/pedidos')
        .send({
          tipo: 'LOCAL',
          nombreCliente: 'Cliente Sin Extras Test',
          detalles: [
            {
              productoId: productoId,
              cantidad: 1,
              sinExtras: true,
            },
          ],
        });

      expect(response.status).toBe(201);
      expect(response.body.detalles[0].sinExtras).toBe(true);
    });

    it('debe calcular correctamente el total con extras pagos', async () => {
      const precioProducto = 1500;
      const precioExtra = 200;
      const extrasPagos = 3;
      const totalEsperado = precioProducto + precioExtra * extrasPagos;

      const response = await request(app.getHttpServer())
        .post('/pedidos')
        .send({
          tipo: 'LOCAL',
          nombreCliente: 'Cliente Calculo Test',
          detalles: [
            {
              productoId: productoId,
              cantidad: 1,
              extras: [
                { extraId: extraId, cantidad: 1 },
                { extraId: extraId, cantidad: 1 },
                { extraId: extraId, cantidad: 1 },
                { extraId: extraId, cantidad: 1 },
                { extraId: extraId, cantidad: 1 },
              ],
            },
          ],
        });

      expect(response.status).toBe(201);
      expect(response.body.total).toBe(totalEsperado);
    });
  });

  describe('Stock', () => {
    it('debe descontar stock de insumos al crear pedido', async () => {
      const insumoAntes = await request(app.getHttpServer())
        .get(`/insumos/${insumoId}`)
        .set('Authorization', `Bearer ${authToken}`);

      const stockAntes = Number(insumoAntes.body.stockActual);

      await request(app.getHttpServer())
        .post('/pedidos')
        .send({
          tipo: 'LOCAL',
          nombreCliente: 'Cliente Stock Test',
          detalles: [
            {
              productoId: productoId,
              cantidad: 2,
            },
          ],
        })
        .expect(201);

      const insumoDespues = await request(app.getHttpServer())
        .get(`/insumos/${insumoId}`)
        .set('Authorization', `Bearer ${authToken}`);

      const stockDespues = Number(insumoDespues.body.stockActual);
      const consumoPorProducto = 100;
      const cantidad = 2;
      const stockEsperado = stockAntes - consumoPorProducto * cantidad;

      expect(stockDespues).toBe(stockEsperado);
    });
  });
});
