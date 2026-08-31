import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AdminInsumosController } from './admin-insumos.controller';
import { InsumosController } from './insumos.controller';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { ROLES_KEY } from '../auth/roles.decorator';
import { AdminInsumosQueryDto } from './dto/admin-insumos-query.dto';
import { CreateInsumoDto } from './dto/create-insumo.dto';
import { MovimientosQueryDto } from './dto/movimientos-query.dto';
import { ReporteConsumoQueryDto } from './dto/reporte-consumo-query.dto';
import { UpdateInsumoDto } from './dto/update-insumo.dto';

/**
 * Quien puede llamar a que, y que forma tiene que tener lo que manda.
 *
 * Va cubierto por test y no solo por revision porque los dos lados son
 * regresiones silenciosas: un @Public() de mas expone el stock del deposito, y
 * un `stockMinimo` que deje de ser obligatorio devuelve al insumo al umbral
 * implicito que esta seccion elimino.
 */
describe('Insumos — rutas, permisos y validacion', () => {
  const roles = (metodo: any) => Reflect.getMetadata(ROLES_KEY, metodo);
  const esPublico = (metodo: any) =>
    Reflect.getMetadata(IS_PUBLIC_KEY, metodo) === true;

  /** Los mensajes de todas las restricciones que fallaron, aplanados. */
  async function errores(dto: object): Promise<string[]> {
    const fallas = await validate(dto, { whitelist: true });
    return fallas.flatMap((f) => Object.values(f.constraints ?? {}));
  }

  describe('InsumosController', () => {
    const proto = InsumosController.prototype;

    it('nada del CRUD de stock es publico', () => {
      expect(Reflect.getMetadata('path', InsumosController)).toBe('insumos');

      const todos = [
        proto.crear,
        proto.obtenerTodo,
        proto.actualizar,
        proto.sumarStock,
        proto.descontarStock,
        proto.obtenerMovimientos,
        proto.obtenerMovimientosRecientes,
        proto.setActivo,
        proto.baja,
        proto.alta,
        proto.borrar,
        proto.reporteConsumo,
      ];
      expect(todos.some(esPublico)).toBe(false);
    });

    it('el listado y el historial los lee tambien el POS', () => {
      for (const metodo of [
        proto.obtenerTodo,
        proto.obtenerMovimientos,
        proto.obtenerMovimientosRecientes,
        proto.reporteConsumo,
      ]) {
        expect(roles(metodo)).toEqual(['ADMIN', 'TRABAJADOR']);
      }
    });

    it('sumar stock lo puede hacer el TRABAJADOR; restar y el resto, solo ADMIN', () => {
      // El que recibe la mercaderia carga lo que llego; descontar a mano es
      // corregir el inventario y queda del lado de ADMIN.
      expect(roles(proto.sumarStock)).toEqual(['ADMIN', 'TRABAJADOR']);

      for (const metodo of [
        proto.crear,
        proto.actualizar,
        proto.descontarStock,
        proto.setActivo,
        proto.baja,
        proto.alta,
        proto.borrar,
      ]) {
        expect(roles(metodo)).toEqual(['ADMIN']);
      }
    });
  });

  describe('AdminInsumosController', () => {
    const proto = AdminInsumosController.prototype;

    it('cuelga de /admin, igual que las otras pantallas del panel', () => {
      expect(Reflect.getMetadata('path', AdminInsumosController)).toBe('admin');
      expect(Reflect.getMetadata('path', proto.listar)).toBe('insumos');
      expect(Reflect.getMetadata('path', proto.reporteConsumo)).toBe(
        'insumos/reporte-consumo',
      );
      expect(Reflect.getMetadata('path', proto.historial)).toBe(
        'insumos/:id/movimientos',
      );
    });

    it('no expone nada publico y lo lee ADMIN o TRABAJADOR', () => {
      for (const metodo of [
        proto.listar,
        proto.reporteConsumo,
        proto.historial,
      ]) {
        expect(esPublico(metodo)).toBe(false);
        expect(roles(metodo)).toEqual(['ADMIN', 'TRABAJADOR']);
      }
    });
  });

  describe('CreateInsumoDto', () => {
    const valido = {
      nombre: 'Muzzarella',
      unidadMedida: 'kg',
      stockActual: 4,
      stockMinimo: 8,
    };

    const armar = (extra: object = {}) =>
      plainToInstance(CreateInsumoDto, { ...valido, ...extra });

    it('acepta un alta completa', async () => {
      expect(await errores(armar())).toEqual([]);
    });

    it('exige stockMinimo: no hay umbral global del que heredar', async () => {
      const sinMinimo = plainToInstance(CreateInsumoDto, {
        nombre: 'Muzzarella',
        unidadMedida: 'kg',
        stockActual: 4,
      });

      expect(await errores(sinMinimo)).toContain(
        'stockMinimo debe ser mayor a 0',
      );
    });

    it('rechaza un stockMinimo en 0: seria volver a no tener umbral', async () => {
      expect(await errores(armar({ stockMinimo: 0 }))).toContain(
        'stockMinimo debe ser mayor a 0',
      );
    });

    it('rechaza stock negativo pero acepta arrancar en cero', async () => {
      expect(await errores(armar({ stockActual: -1 }))).toContain(
        'stockActual no puede ser negativo',
      );
      // Un insumo puede darse de alta antes de que llegue la primera compra.
      expect(await errores(armar({ stockActual: 0 }))).toEqual([]);
    });

    it('rechaza una unidad de medida fuera de la lista', async () => {
      const fallas = await errores(armar({ unidadMedida: 'toneladas' }));
      expect(fallas.join(' ')).toContain('unidadMedida debe ser una de');
    });

    it('sigue aceptando las unidades que ya estan en la base', async () => {
      // Los 47 insumos que existen hoy usan 'unidades'; una lista cerrada sin
      // ese valor los dejaria sin poder editarse.
      for (const unidad of ['unidades', 'un', 'kg', 'g', 'l', 'ml', 'u']) {
        expect(await errores(armar({ unidadMedida: unidad }))).toEqual([]);
      }
    });

    it('acepta proveedorId en null (sin proveedor) y rechaza un id que no sea uuid', async () => {
      expect(await errores(armar({ proveedorId: null }))).toEqual([]);
      expect(await errores(armar({ proveedorId: 'pr1' }))).toContain(
        'proveedorId debe ser un uuid',
      );
    });

    it('sigue aceptando el alias stockInicial del form que hay en produccion', async () => {
      const legacy = plainToInstance(CreateInsumoDto, {
        nombre: 'Muzzarella',
        unidadMedida: 'kg',
        stockInicial: 12,
        stockMinimo: 8,
      });

      expect(await errores(legacy)).toEqual([]);
    });
  });

  describe('UpdateInsumoDto', () => {
    it('todo es opcional: es un PATCH', async () => {
      expect(await errores(plainToInstance(UpdateInsumoDto, {}))).toEqual([]);
    });

    it('pero el stockMinimo no se puede apagar', async () => {
      expect(
        await errores(plainToInstance(UpdateInsumoDto, { stockMinimo: 0 })),
      ).toContain('stockMinimo debe ser mayor a 0');
    });

    it('rechaza vaciar el nombre', async () => {
      expect(
        await errores(plainToInstance(UpdateInsumoDto, { nombre: '' })),
      ).toContain('El nombre no puede estar vacio');
    });

    it('null en proveedorId es desasignar, no un error', async () => {
      expect(
        await errores(plainToInstance(UpdateInsumoDto, { proveedorId: null })),
      ).toEqual([]);
    });
  });

  describe('Query DTOs', () => {
    it('el listado rechaza un orden inventado (el ORDER BY se arma con este valor)', async () => {
      const dto = plainToInstance(AdminInsumosQueryDto, {
        orden: 'DROP TABLE',
      });
      expect((await errores(dto)).join(' ')).toContain('orden debe ser uno de');
    });

    it('el listado tiene techo de pageSize', async () => {
      const dto = plainToInstance(AdminInsumosQueryDto, { pageSize: 5000 });
      expect(await errores(dto)).toContain('pageSize no puede superar 100');
    });

    it('el historial tiene techo de limit', async () => {
      const dto = plainToInstance(MovimientosQueryDto, { limit: 999999 });
      expect(await errores(dto)).toContain('limit no puede superar 200');
    });

    it('el reporte pide las fechas como YYYY-MM-DD, sin zona', async () => {
      const dto = plainToInstance(ReporteConsumoQueryDto, {
        desde: '2026-08-10T00:00:00Z',
      });
      // Mandar un timestamp con zona invitaria a que el cliente decidiera un
      // limite que le corresponde al server.
      expect(await errores(dto)).toContain(
        'desde debe tener el formato YYYY-MM-DD',
      );
    });
  });
});
