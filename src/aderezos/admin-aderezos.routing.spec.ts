import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from '@prisma/client';

import { AdminAderezosController } from './admin-aderezos.controller';
import { AderezosController } from './aderezos.controller';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { ROLES_KEY } from '../auth/roles.decorator';
import { AdminAderezosQueryDto } from './dto/admin-aderezos-query.dto';
import {
  CrearAderezoDto,
  EditarAderezoDto,
  UpdateAderezoLegacyDto,
} from './dto/admin-aderezo.dto';
import { ToggleActivoAderezoDto } from './dto/toggle-activo.dto';
import { StockMovAderezoDto } from './dto/stock-mov.dto';

const UUID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

/**
 * Quien puede llamar a que, y que forma tiene que tener lo que manda.
 *
 * Va cubierto por test y no solo por revision porque son regresiones
 * silenciosas: un @Public() de mas en /admin/aderezos expone la configuracion
 * de stock del negocio, y un `stockMinimo` o una `unidadMedida` que dejen de
 * ser obligatorios devuelven a las salsas al estado que esta seccion viene a
 * arreglar (9 de 11 sin unidad, ninguna con umbral propio).
 */
describe('Aderezos admin — rutas, permisos y validacion', () => {
  const proto = AdminAderezosController.prototype;
  const roles = (metodo: any) => Reflect.getMetadata(ROLES_KEY, metodo);
  const esPublico = (metodo: any) =>
    Reflect.getMetadata(IS_PUBLIC_KEY, metodo) === true;

  async function errores(dto: object): Promise<string[]> {
    return correr(dto, { whitelist: true });
  }

  /**
   * Con las mismas opciones que el ValidationPipe global de `main.ts`
   * (`whitelist` + `forbidNonWhitelisted`), que es lo unico que decide si una
   * propiedad que el DTO no declara entra o rebota. `plainToInstance` NO sirve
   * para comprobarlo: copia cualquier clave al objeto igual.
   */
  async function erroresEstrictos(dto: object): Promise<string[]> {
    return correr(dto, { whitelist: true, forbidNonWhitelisted: true });
  }

  async function correr(dto: object, opciones: object): Promise<string[]> {
    const fallas = await validate(dto, opciones);
    const aplanar = (lista: any[]): string[] =>
      lista.flatMap((f) => [
        ...Object.values(f.constraints ?? {}),
        ...aplanar(f.children ?? []),
      ]) as string[];
    return aplanar(fallas);
  }

  const todos = [
    proto.listar,
    proto.detalle,
    proto.historial,
    proto.crear,
    proto.editar,
    proto.setActivo,
    proto.eliminar,
  ];

  describe('rutas y permisos', () => {
    it('cuelga de /admin/aderezos', () => {
      expect(Reflect.getMetadata('path', AdminAderezosController)).toBe(
        'admin/aderezos',
      );
    });

    it('nada del panel es publico', () => {
      expect(todos.some(esPublico)).toBe(false);
    });

    it('todo es solo ADMIN, lectura incluida', () => {
      // El POS NO consume estos endpoints: pide GET /aderezos, que es publico.
      for (const metodo of todos) {
        expect(roles(metodo)).toEqual([Role.ADMIN]);
      }
    });

    it('los endpoints publicos de la carta siguen siendo publicos', () => {
      // El menu y el POS consumen ESTOS, no los del panel. Si dejaran de ser
      // publicos, la carta se cae: por eso el test vive de este lado tambien.
      const viejo = AderezosController.prototype;
      expect(esPublico(viejo.findAll)).toBe(true);
      expect(esPublico(viejo.findByCategoriaProducto)).toBe(true);
      expect(esPublico(viejo.findByCategoriaProductoConStock)).toBe(true);
    });
  });

  describe('AdminAderezosQueryDto', () => {
    it('acepta vacio: la pantalla arranca sin filtros', async () => {
      expect(await errores(plainToInstance(AdminAderezosQueryDto, {}))).toEqual(
        [],
      );
    });

    it('rechaza enums fuera de la lista (el ORDER BY se arma con esto)', async () => {
      const fallas = await errores(
        plainToInstance(AdminAderezosQueryDto, {
          orden: 'DROP TABLE',
          estado: 'CUALQUIERA',
          alcance: 'NINGUNO',
          disponibilidad: 'X',
        }),
      );
      expect(fallas).toHaveLength(4);
    });

    it('clampea pageSize y dias por validacion', async () => {
      const fallas = await errores(
        plainToInstance(AdminAderezosQueryDto, { pageSize: 500, dias: 999 }),
      );
      expect(fallas.join(' ')).toContain('pageSize no puede superar 100');
      expect(fallas.join(' ')).toContain('dias no puede superar 366');
    });

    it('acepta la combinacion que usa la pantalla', async () => {
      const fallas = await errores(
        plainToInstance(AdminAderezosQueryDto, {
          q: 'mayo',
          estado: 'POR_REPONER',
          disponibilidad: 'ACTIVOS',
          alcance: 'GLOBALES',
          orden: 'AGUANTE',
          page: 2,
          pageSize: 20,
          dias: 30,
        }),
      );
      expect(fallas).toEqual([]);
    });
  });

  describe('CrearAderezoDto', () => {
    const base = { nombre: 'Mayonesa', unidadMedida: 'kg', stockMinimo: 6 };

    it('acepta el alta minima', async () => {
      expect(await errores(plainToInstance(CrearAderezoDto, base))).toEqual([]);
    });

    it('stockMinimo es obligatorio y no puede ser 0', async () => {
      const sinMinimo = await errores(
        plainToInstance(CrearAderezoDto, {
          nombre: 'Mayonesa',
          unidadMedida: 'kg',
        }),
      );
      expect(sinMinimo.join(' ')).toContain('stockMinimo');

      const enCero = await errores(
        plainToInstance(CrearAderezoDto, { ...base, stockMinimo: 0 }),
      );
      expect(enCero).toContain('stockMinimo debe ser mayor a 0');
    });

    it('unidadMedida es obligatoria y sale de la lista blanca', async () => {
      const sinUnidad = await errores(
        plainToInstance(CrearAderezoDto, {
          nombre: 'Mayonesa',
          stockMinimo: 6,
        }),
      );
      expect(sinUnidad.join(' ')).toContain('unidadMedida');

      const invalida = await errores(
        plainToInstance(CrearAderezoDto, { ...base, unidadMedida: 'baldes' }),
      );
      expect(invalida.join(' ')).toContain('unidadMedida debe ser una de');
    });

    it('NO tiene precio: las salsas son siempre gratis', async () => {
      // Si alguien agrega un campo de precio, este test lo frena. La decision
      // de producto es que no se cobran, y "AderezoPrecio" esta para deprecar.
      const fallas = await erroresEstrictos(
        plainToInstance(CrearAderezoDto, { ...base, precio: 500 }),
      );
      expect(fallas.join(' ')).toContain('precio');
    });

    it('stockActual no puede ser negativo, pero puede ser 0', async () => {
      // 0 es el default nuevo: antes toda salsa nacia en 999 sin que nadie lo
      // hubiera contado.
      expect(
        await errores(
          plainToInstance(CrearAderezoDto, { ...base, stockActual: 0 }),
        ),
      ).toEqual([]);
      expect(
        await errores(
          plainToInstance(CrearAderezoDto, { ...base, stockActual: -1 }),
        ),
      ).toContain('stockActual no puede ser negativo');
    });

    it('el consumo por categoria tiene que ser mayor a 0', async () => {
      const fallas = await errores(
        plainToInstance(CrearAderezoDto, {
          ...base,
          consumos: [{ categoriaId: UUID, cantidadConsumo: 0 }],
        }),
      );
      expect(fallas).toContain('cantidadConsumo debe ser mayor a 0');
    });

    it('categoriaIds tiene que traer uuids', async () => {
      const fallas = await errores(
        plainToInstance(CrearAderezoDto, { ...base, categoriaIds: ['pepe'] }),
      );
      expect(fallas).toContain('categoriaIds debe traer uuids');
    });
  });

  describe('EditarAderezoDto', () => {
    it('acepta vacio: un PATCH puede no tocar nada', async () => {
      expect(await errores(plainToInstance(EditarAderezoDto, {}))).toEqual([]);
    });

    it('stockMinimo se puede omitir pero no apagar', async () => {
      expect(
        await errores(plainToInstance(EditarAderezoDto, { stockMinimo: 0 })),
      ).toContain('stockMinimo debe ser mayor a 0');
    });

    it('la unidad se puede cambiar pero no a cualquier cosa', async () => {
      expect(
        await errores(plainToInstance(EditarAderezoDto, { unidadMedida: 'g' })),
      ).toEqual([]);
      expect(
        await errores(plainToInstance(EditarAderezoDto, { unidadMedida: '' })),
      ).not.toEqual([]);
    });
  });

  describe('UpdateAderezoLegacyDto (PATCH /aderezos/:id)', () => {
    it('no acepta consumos: ese endpoint no sabe guardarlos', async () => {
      // Con forbidNonWhitelisted, mandarlo devuelve un 400 explicito en vez de
      // que el service se lo trague en silencio.
      const fallas = await erroresEstrictos(
        plainToInstance(UpdateAderezoLegacyDto, {
          consumos: [{ categoriaId: UUID, cantidadConsumo: 5 }],
        }),
      );
      expect(fallas.join(' ')).toContain('consumos');

      // Y el mismo body SI pasa por el DTO del panel, que si sabe guardarlo.
      expect(
        await erroresEstrictos(
          plainToInstance(EditarAderezoDto, {
            consumos: [{ categoriaId: UUID, cantidadConsumo: 5 }],
          }),
        ),
      ).toEqual([]);
    });

    it('mantiene las validaciones de la unidad y el minimo', async () => {
      const fallas = await errores(
        plainToInstance(UpdateAderezoLegacyDto, {
          unidadMedida: 'baldes',
          stockMinimo: 0,
        }),
      );
      expect(fallas.join(' ')).toContain('unidadMedida debe ser una de');
      expect(fallas).toContain('stockMinimo debe ser mayor a 0');
    });
  });

  describe('DTOs de los PATCH que antes no validaban nada', () => {
    it('ToggleActivoAderezoDto exige un booleano', async () => {
      // Antes era `@Body() dto: { activo: boolean }` inline: TypeScript lo
      // borra al compilar y el ValidationPipe no tenia nada que mirar, asi que
      // un body vacio pausaba la salsa (`Boolean(undefined)` === false).
      expect(
        await errores(plainToInstance(ToggleActivoAderezoDto, {})),
      ).toContain('activo tiene que ser true o false');
      expect(
        await errores(
          plainToInstance(ToggleActivoAderezoDto, { activo: false }),
        ),
      ).toEqual([]);
    });

    it('StockMovAderezoDto exige una cantidad mayor a 0', async () => {
      expect(
        await errores(plainToInstance(StockMovAderezoDto, {})),
      ).not.toEqual([]);
      expect(
        await errores(plainToInstance(StockMovAderezoDto, { cantidad: 0 })),
      ).toContain('cantidad debe ser mayor a 0');
      expect(
        await errores(
          plainToInstance(StockMovAderezoDto, {
            cantidad: 2.5,
            motivo: 'compra',
          }),
        ),
      ).toEqual([]);
    });
  });
});
