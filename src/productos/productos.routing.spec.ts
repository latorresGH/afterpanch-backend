import { Test } from '@nestjs/testing';

import { AdminProductosController } from './admin-productos.controller';
import { AdminProductosService } from './admin-productos.service';
import { ProductosController } from './productos.controller';
import { ProductosService } from './productos.service';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { ROLES_KEY } from '../auth/roles.decorator';

/**
 * Quien puede llamar a que. Es la mitad del fix de seguridad de esta seccion,
 * asi que va cubierto por test y no solo por revision: el dia que alguien
 * agregue un @Public() de mas en este controller, esto se pone en rojo.
 */
describe('Productos — rutas y permisos', () => {
  const roles = (metodo: any) => Reflect.getMetadata(ROLES_KEY, metodo);
  const esPublico = (metodo: any) =>
    Reflect.getMetadata(IS_PUBLIC_KEY, metodo) === true;

  describe('ProductosController', () => {
    const proto = ProductosController.prototype;

    it('el menu (GET /productos) es lo unico publico', () => {
      expect(Reflect.getMetadata('path', ProductosController)).toBe(
        'productos',
      );
      expect(esPublico(proto.obtenerTodos)).toBe(true);

      const resto = [
        proto.obtenerCompleto,
        proto.findOne,
        proto.getStats,
        proto.crear,
        proto.update,
        proto.setActivo,
        proto.baja,
        proto.alta,
        proto.remove,
      ];
      expect(resto.some(esPublico)).toBe(false);
    });

    it('la vista completa (receta, stock, pausados) pide estar logueado', () => {
      expect(roles(proto.obtenerCompleto)).toEqual(['ADMIN', 'TRABAJADOR']);
      expect(Reflect.getMetadata('path', proto.obtenerCompleto)).toBe(
        'completo',
      );
    });

    it('la ficha de un producto tampoco es publica', () => {
      expect(roles(proto.findOne)).toEqual(['ADMIN', 'TRABAJADOR']);
    });

    it('todo lo que escribe es solo ADMIN', () => {
      for (const metodo of [
        proto.crear,
        proto.update,
        proto.setActivo,
        proto.baja,
        proto.alta,
        proto.remove,
      ]) {
        expect(roles(metodo)).toEqual(['ADMIN']);
      }
    });

    it('el menu publico ignora incluirInactivos', async () => {
      const servicio = {
        obtenerMenuPublico: jest.fn().mockResolvedValue([]),
        obtenerMenuCompleto: jest.fn(),
      };

      const module = await Test.createTestingModule({
        controllers: [ProductosController],
        providers: [{ provide: ProductosService, useValue: servicio }],
      }).compile();

      const controller = module.get(ProductosController);
      await controller.obtenerTodos('true');

      expect(servicio.obtenerMenuPublico).toHaveBeenCalledWith();
      expect(servicio.obtenerMenuCompleto).not.toHaveBeenCalled();
    });

    /**
     * `baja` y `alta` quedan deprecados pero vivos: el front actual todavia
     * pega ahi. Si se borran antes de migrarlo, se rompe pausar un producto.
     */
    it('baja y alta siguen delegando en el canonico setActivo', async () => {
      const servicio = { setActivo: jest.fn().mockResolvedValue({}) };

      const module = await Test.createTestingModule({
        controllers: [ProductosController],
        providers: [{ provide: ProductosService, useValue: servicio }],
      }).compile();

      const controller = module.get(ProductosController);
      await controller.baja('p1');
      await controller.alta('p1');
      await controller.setActivo('p1', { activo: false });

      expect(servicio.setActivo.mock.calls).toEqual([
        ['p1', false],
        ['p1', true],
        ['p1', false],
      ]);
    });
  });

  describe('AdminProductosController', () => {
    it('la ruta es GET /admin/productos y pide rol ADMIN', () => {
      const path = Reflect.getMetadata('path', AdminProductosController);
      const subPath = Reflect.getMetadata(
        'path',
        AdminProductosController.prototype.listar,
      );

      expect(`${path}/${subPath}`).toBe('admin/productos');
      expect(roles(AdminProductosController.prototype.listar)).toEqual([
        'ADMIN',
      ]);
    });

    it('pasa el query al service tal cual', async () => {
      const servicio = { listar: jest.fn().mockResolvedValue({ ok: true }) };

      const module = await Test.createTestingModule({
        controllers: [AdminProductosController],
        providers: [{ provide: AdminProductosService, useValue: servicio }],
      }).compile();

      const controller = module.get(AdminProductosController);
      await controller.listar({ page: 2, q: 'cheddar' });

      expect(servicio.listar).toHaveBeenCalledWith({ page: 2, q: 'cheddar' });
    });
  });
});
