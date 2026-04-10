import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * TESTS CRÍTICOS DE STOCK
 *
 * Valida:
 * 1. Descuento de stock al crear pedido
 * 2. Restauración de stock al cancelar pedido
 * 3. Nunca permite stock negativo (concurrencia)
 * 4. Extras con/sin insumo asociado
 */
describe('Stock Crítico (e2e)', () => {
  let app: INestApplication<App>;
  let authToken: string;
  let adminToken: string;
  let productoId: string;
  let insumoId: string;
  let extraSinInsumoId: string;
  let extraConInsumoId: string;
  let insumoExtraId: string;

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
    it('crea usuario admin para tests', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: `stock-test-${Date.now()}@test.com`,
          password: 'password123',
          nombre: 'Stock Test Admin',
        })
        .expect(201);

      adminToken = response.body.access_token;
      expect(adminToken).toBeDefined();
    });

    it('crea insumo para receta', async () => {
      const response = await request(app.getHttpServer())
        .post('/insumos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          nombre: `Carne Stock Test ${Date.now()}`,
          stockInicial: 1000,
          unidad: 'gr',
        })
        .expect(201);

      insumoId = response.body.id;
      expect(Number(response.body.stockActual)).toBe(1000);
    });

    it('crea insumo para extra', async () => {
      const response = await request(app.getHttpServer())
        .post('/insumos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          nombre: `Queso Insumo Test ${Date.now()}`,
          stockInicial: 50,
          unidad: 'gr',
        })
        .expect(201);

      insumoExtraId = response.body.id;
    });

    it('crea categoria', async () => {
      const response = await request(app.getHttpServer())
        .post('/categorias')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          nombre: `Stock Test Cat ${Date.now()}`,
        })
        .expect(201);

      const categoriaId = response.body.id;

      // Crear producto con receta
      const prodResponse = await request(app.getHttpServer())
        .post('/productos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          nombre: `Hamburguesa Stock Test ${Date.now()}`,
          precio: 2000,
          categoriaId,
          receta: [{ insumoId, cantidad: 150 }],
        })
        .expect(201);

      productoId = prodResponse.body.id;
    });

    it('crea extra SIN insumo asociado', async () => {
      const response = await request(app.getHttpServer())
        .post('/extras')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          nombre: `Extra Sin Insumo ${Date.now()}`,
          precio: 300,
          stockActual: 20,
          categoria: 'EXTRAS',
        })
        .expect(201);

      extraSinInsumoId = response.body.id;
      expect(response.body.insumoId).toBeNull();
    });

    it('crea extra CON insumo asociado', async () => {
      const response = await request(app.getHttpServer())
        .post('/extras')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          nombre: `Extra Con Insumo ${Date.now()}`,
          precio: 500,
          stockActual: 100,
          categoria: 'EXTRAS',
          insumoId: insumoExtraId,
        })
        .expect(201);

      extraConInsumoId = response.body.id;
      expect(response.body.insumoId).toBe(insumoExtraId);
    });
  });

  describe('Descuento de stock', () => {
    it('descuenta stock de insumo al crear pedido', async () => {
      const insumoAntes = await request(app.getHttpServer())
        .get(`/insumos/${insumoId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      const stockAntes = Number(insumoAntes.body.stockActual);

      const pedidoResponse = await request(app.getHttpServer())
        .post('/pedidos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          tipo: 'LOCAL',
          nombreCliente: 'Stock Descuento Test',
          detalles: [
            {
              productoId,
              cantidad: 2,
            },
          ],
        })
        .expect(201);

      const insumoDespues = await request(app.getHttpServer())
        .get(`/insumos/${insumoId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      const stockDespues = Number(insumoDespues.body.stockActual);
      const consumoEsperado = 150 * 2; // 150gr por producto, 2 productos

      expect(stockDespues).toBe(stockAntes - consumoEsperado);
    });

    it('descuenta stock de EXTRA SIN insumo', async () => {
      const extraAntes = await request(app.getHttpServer())
        .get(`/extras/${extraSinInsumoId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      const stockAntes = Number(extraAntes.body.stockActual);

      await request(app.getHttpServer())
        .post('/pedidos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          tipo: 'LOCAL',
          nombreCliente: 'Extra Sin Insumo Test',
          detalles: [
            {
              productoId,
              cantidad: 1,
              extras: [{ extraId: extraSinInsumoId, cantidad: 3 }],
            },
          ],
        })
        .expect(201);

      const extraDespues = await request(app.getHttpServer())
        .get(`/extras/${extraSinInsumoId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      const stockDespues = Number(extraDespues.body.stockActual);

      expect(stockDespues).toBe(stockAntes - 3);
    });

    it('descuenta stock del INSUMO cuando extra tiene insumoId', async () => {
      const insumoAntes = await request(app.getHttpServer())
        .get(`/insumos/${insumoExtraId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      const stockInsumoAntes = Number(insumoAntes.body.stockActual);

      const extraAntes = await request(app.getHttpServer())
        .get(`/extras/${extraConInsumoId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      // El stock del extra NO debe cambiar (se controla por insumo)
      const stockExtraAntes = Number(extraAntes.body.stockActual);

      await request(app.getHttpServer())
        .post('/pedidos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          tipo: 'LOCAL',
          nombreCliente: 'Extra Con Insumo Test',
          detalles: [
            {
              productoId,
              cantidad: 1,
              extras: [{ extraId: extraConInsumoId, cantidad: 2 }],
            },
          ],
        })
        .expect(201);

      const insumoDespues = await request(app.getHttpServer())
        .get(`/insumos/${insumoExtraId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      const stockInsumoDespues = Number(insumoDespues.body.stockActual);

      // El stock del INSUMO debe haber bajado
      expect(stockInsumoDespues).toBe(stockInsumoAntes - 2);

      // El stock del EXTRA no debe haber cambiado
      const extraDespues = await request(app.getHttpServer())
        .get(`/extras/${extraConInsumoId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(Number(extraDespues.body.stockActual)).toBe(stockExtraAntes);
    });
  });

  describe('Restauración de stock al cancelar', () => {
    let pedidoId: string;
    let stockInsumoAntes: number;
    let stockExtraAntes: number;

    it('crea pedido para luego cancelar', async () => {
      const insumoAntes = await request(app.getHttpServer())
        .get(`/insumos/${insumoId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      stockInsumoAntes = Number(insumoAntes.body.stockActual);

      const extraAntes = await request(app.getHttpServer())
        .get(`/extras/${extraSinInsumoId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      stockExtraAntes = Number(extraAntes.body.stockActual);

      const response = await request(app.getHttpServer())
        .post('/pedidos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          tipo: 'LOCAL',
          nombreCliente: 'Pedido a Cancelar',
          detalles: [
            {
              productoId,
              cantidad: 1,
              extras: [{ extraId: extraSinInsumoId, cantidad: 2 }],
            },
          ],
        })
        .expect(201);

      pedidoId = response.body.id;
    });

    it('restaura stock al cancelar pedido', async () => {
      await request(app.getHttpServer())
        .post(`/pedidos/${pedidoId}/cancelar`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          motivo: 'Test de cancelación',
          rol: 'ADMIN',
        })
        .expect(201);

      const insumoDespues = await request(app.getHttpServer())
        .get(`/insumos/${insumoId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      const extraDespues = await request(app.getHttpServer())
        .get(`/extras/${extraSinInsumoId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Stock restaurado
      expect(Number(insumoDespues.body.stockActual)).toBe(stockInsumoAntes);
      expect(Number(extraDespues.body.stockActual)).toBe(stockExtraAntes);
    });
  });

  describe('Protección de stock negativo', () => {
    it('rechaza pedido si no hay stock suficiente de insumo', async () => {
      // Crear insumo con poco stock
      const response = await request(app.getHttpServer())
        .post('/insumos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          nombre: `Insumo Limitado ${Date.now()}`,
          stockInicial: 50,
          unidad: 'gr',
        })
        .expect(201);

      const insumoLimitadoId = response.body.id;

      // Crear categoria y producto
      const catResponse = await request(app.getHttpServer())
        .post('/categorias')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nombre: `Cat Limitada ${Date.now()}` })
        .expect(201);

      const prodResponse = await request(app.getHttpServer())
        .post('/productos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          nombre: `Producto Limitado ${Date.now()}`,
          precio: 1000,
          categoriaId: catResponse.body.id,
          receta: [{ insumoId: insumoLimitadoId, cantidad: 30 }],
        })
        .expect(201);

      const productoLimitadoId = prodResponse.body.id;

      // Intentar pedir más de lo que hay
      const pedidoResponse = await request(app.getHttpServer())
        .post('/pedidos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          tipo: 'LOCAL',
          nombreCliente: 'Test Stock Insuficiente',
          detalles: [
            {
              productoId: productoLimitadoId,
              cantidad: 2, // Necesita 60gr pero solo hay 50
            },
          ],
        });

      expect(pedidoResponse.status).toBe(400);
      expect(pedidoResponse.body.message).toContain('Stock insuficiente');
    });

    it('rechaza pedido si no hay stock suficiente de extra', async () => {
      // Crear extra con poco stock
      const response = await request(app.getHttpServer())
        .post('/extras')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          nombre: `Extra Limitado ${Date.now()}`,
          precio: 100,
          stockActual: 2,
          categoria: 'EXTRAS',
        })
        .expect(201);

      const extraLimitadoId = response.body.id;

      // Intentar pedir más extras de los que hay
      const pedidoResponse = await request(app.getHttpServer())
        .post('/pedidos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          tipo: 'LOCAL',
          nombreCliente: 'Test Extra Insuficiente',
          detalles: [
            {
              productoId,
              cantidad: 1,
              extras: [{ extraId: extraLimitadoId, cantidad: 5 }],
            },
          ],
        });

      expect(pedidoResponse.status).toBe(400);
      expect(pedidoResponse.body.message).toContain('Stock insuficiente');
    });
  });

  describe('Lógica de extras (2 gratis, resto se cobra)', () => {
    it('los primeros 2 extras son gratis', async () => {
      const response = await request(app.getHttpServer())
        .post('/pedidos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          tipo: 'LOCAL',
          nombreCliente: 'Extras Gratis Test',
          detalles: [
            {
              productoId,
              cantidad: 1,
              extras: [
                { extraId: extraSinInsumoId, cantidad: 1 },
                { extraId: extraSinInsumoId, cantidad: 1 },
              ],
            },
          ],
        })
        .expect(201);

      // El total debe ser solo el precio del producto
      // (no se cobran los 2 primeros extras)
      const precioProducto = 2000;
      expect(response.body.total).toBe(precioProducto);
    });

    it('a partir del 3er extra se cobra', async () => {
      const response = await request(app.getHttpServer())
        .post('/pedidos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          tipo: 'LOCAL',
          nombreCliente: 'Extras Cobrados Test',
          detalles: [
            {
              productoId,
              cantidad: 1,
              extras: [
                { extraId: extraSinInsumoId, cantidad: 1 },
                { extraId: extraSinInsumoId, cantidad: 1 },
                { extraId: extraSinInsumoId, cantidad: 1 },
                { extraId: extraSinInsumoId, cantidad: 1 },
              ],
            },
          ],
        })
        .expect(201);

      const precioProducto = 2000;
      const precioExtra = 300;
      const extrasPagos = 2; // Los 2 últimos de 4

      expect(response.body.total).toBe(
        precioProducto + precioExtra * extrasPagos,
      );
    });
  });
});
