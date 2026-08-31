import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from '@prisma/client';

import { AdminExtrasController } from './admin-extras.controller';
import { ExtrasController } from './extras.controller';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { ROLES_KEY } from '../auth/roles.decorator';
import { AdminExtrasQueryDto } from './dto/admin-extras-query.dto';
import { CrearExtraDto, EditarExtraDto } from './dto/admin-extra.dto';

const UUID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

/**
 * Quien puede llamar a que, y que forma tiene que tener lo que manda.
 *
 * Va cubierto por test y no solo por revision porque son regresiones
 * silenciosas: un @Public() de mas en /admin/extras expone el costo y el
 * consumo de la carta, y un `stockMinimo` que deje de ser obligatorio devuelve
 * al extra al umbral implicito que esta seccion elimina.
 */
describe('Extras admin — rutas, permisos y validacion', () => {
  const proto = AdminExtrasController.prototype;
  const roles = (metodo: any) => Reflect.getMetadata(ROLES_KEY, metodo);
  const esPublico = (metodo: any) =>
    Reflect.getMetadata(IS_PUBLIC_KEY, metodo) === true;

  async function errores(dto: object): Promise<string[]> {
    const fallas = await validate(dto, { whitelist: true });
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
    it('cuelga de /admin/extras', () => {
      expect(Reflect.getMetadata('path', AdminExtrasController)).toBe(
        'admin/extras',
      );
    });

    it('nada del panel es publico', () => {
      expect(todos.some(esPublico)).toBe(false);
    });

    it('todo es solo ADMIN, lectura incluida', () => {
      for (const metodo of todos) {
        expect(roles(metodo)).toEqual([Role.ADMIN]);
      }
    });

    it('los endpoints publicos de la carta siguen siendo publicos', () => {
      // El menu y el POS consumen ESTOS, no los del panel. Si dejaran de ser
      // publicos, la carta se cae: por eso el test vive de este lado tambien.
      const viejo = ExtrasController.prototype;
      expect(esPublico(viejo.findAll)).toBe(true);
      expect(esPublico(viejo.findByCategoriaProducto)).toBe(true);
      expect(esPublico(viejo.findByCategoriaProductoConStock)).toBe(true);
    });
  });

  describe('AdminExtrasQueryDto', () => {
    it('acepta vacio: la pantalla arranca sin filtros', async () => {
      expect(await errores(plainToInstance(AdminExtrasQueryDto, {}))).toEqual([]);
    });

    it('rechaza enums fuera de la lista (el ORDER BY se arma con esto)', async () => {
      const dto = plainToInstance(AdminExtrasQueryDto, {
        estado: 'CUALQUIERA',
        alcance: 'NINGUNO',
        orden: '; DROP TABLE "Extra"',
      });

      const msgs = await errores(dto);
      expect(msgs.some((m) => m.includes('estado debe ser uno de'))).toBe(true);
      expect(msgs.some((m) => m.includes('alcance debe ser uno de'))).toBe(true);
      expect(msgs.some((m) => m.includes('orden debe ser uno de'))).toBe(true);
    });

    it('premium solo acepta true/false', async () => {
      expect(
        await errores(plainToInstance(AdminExtrasQueryDto, { premium: 'true' })),
      ).toEqual([]);
      expect(
        (
          await errores(plainToInstance(AdminExtrasQueryDto, { premium: 'si' }))
        ).some((m) => m.includes('premium debe ser')),
      ).toBe(true);
    });

    it('clampea pageSize y dias por validacion', async () => {
      const dto = plainToInstance(AdminExtrasQueryDto, {
        pageSize: 5000,
        dias: 900,
      });

      const msgs = await errores(dto);
      expect(msgs.some((m) => m.includes('pageSize'))).toBe(true);
      expect(msgs.some((m) => m.includes('dias'))).toBe(true);
    });
  });

  describe('CrearExtraDto', () => {
    const base = { nombre: 'Cheddar extra', stockMinimo: 18 };

    it('con nombre y stockMinimo alcanza', async () => {
      expect(await errores(plainToInstance(CrearExtraDto, base))).toEqual([]);
    });

    it('stockMinimo es OBLIGATORIO en el alta', async () => {
      const msgs = await errores(
        plainToInstance(CrearExtraDto, { nombre: 'X' }),
      );
      expect(msgs.some((m) => m.includes('stockMinimo'))).toBe(true);
    });

    it('stockMinimo no puede ser 0 ni negativo', async () => {
      for (const valor of [0, -5]) {
        const msgs = await errores(
          plainToInstance(CrearExtraDto, { ...base, stockMinimo: valor }),
        );
        expect(msgs.some((m) => m.includes('stockMinimo debe ser mayor a 0'))).toBe(
          true,
        );
      }
    });

    it('recorta el nombre y rechaza el que queda vacio', async () => {
      const ok = plainToInstance(CrearExtraDto, { ...base, nombre: '  Queso  ' });
      expect(ok.nombre).toBe('Queso');

      const msgs = await errores(
        plainToInstance(CrearExtraDto, { ...base, nombre: '   ' }),
      );
      expect(msgs.some((m) => m.includes('no puede estar vacio'))).toBe(true);
    });

    it('precio no puede ser negativo', async () => {
      const msgs = await errores(
        plainToInstance(CrearExtraDto, { ...base, precio: -1 }),
      );
      expect(msgs.some((m) => m.includes('precio no puede ser negativo'))).toBe(
        true,
      );
    });

    it('la unidad sale de la lista cerrada', async () => {
      expect(
        await errores(
          plainToInstance(CrearExtraDto, { ...base, unidadMedida: 'u' }),
        ),
      ).toEqual([]);
      expect(
        (
          await errores(
            plainToInstance(CrearExtraDto, { ...base, unidadMedida: 'porrones' }),
          )
        ).some((m) => m.includes('unidadMedida debe ser una de')),
      ).toBe(true);
    });

    it('el consumo por categoria tiene que ser MAYOR a 0', async () => {
      // Un consumo en 0 es indistinguible de no tenerlo configurado, que es
      // justo el agujero que cierra la regla nueva.
      for (const valor of [0, -3]) {
        const msgs = await errores(
          plainToInstance(CrearExtraDto, {
            ...base,
            consumos: [{ categoriaId: UUID, cantidadConsumo: valor }],
          }),
        );
        expect(
          msgs.some((m) => m.includes('cantidadConsumo debe ser mayor a 0')),
        ).toBe(true);
      }

      expect(
        await errores(
          plainToInstance(CrearExtraDto, {
            ...base,
            consumos: [{ categoriaId: UUID, cantidadConsumo: 30 }],
          }),
        ),
      ).toEqual([]);
    });

    it('valida el interior de precios y consumos, no solo que sean arrays', async () => {
      const msgs = await errores(
        plainToInstance(CrearExtraDto, {
          ...base,
          precios: [{ categoriaId: 'no-es-uuid', precio: -1 }],
        }),
      );

      expect(msgs.some((m) => m.includes('categoriaId debe ser un uuid'))).toBe(
        true,
      );
      expect(msgs.some((m) => m.includes('precio no puede ser negativo'))).toBe(
        true,
      );
    });

    it('categoriaIds tiene que traer uuids', async () => {
      const msgs = await errores(
        plainToInstance(CrearExtraDto, { ...base, categoriaIds: ['pizza'] }),
      );
      expect(msgs.some((m) => m.includes('categoriaIds debe traer uuids'))).toBe(
        true,
      );
    });

    it('insumoId acepta null (stock propio) pero no basura', async () => {
      expect(
        await errores(plainToInstance(CrearExtraDto, { ...base, insumoId: null })),
      ).toEqual([]);
      expect(
        (
          await errores(
            plainToInstance(CrearExtraDto, { ...base, insumoId: 'abc' }),
          )
        ).some((m) => m.includes('insumoId debe ser un uuid')),
      ).toBe(true);
    });
  });

  describe('EditarExtraDto', () => {
    it('un PATCH vacio es valido', async () => {
      expect(await errores(plainToInstance(EditarExtraDto, {}))).toEqual([]);
    });

    it('stockMinimo no viene siempre, pero no se puede apagar', async () => {
      expect(
        await errores(plainToInstance(EditarExtraDto, { nombre: 'Otro' })),
      ).toEqual([]);

      const msgs = await errores(
        plainToInstance(EditarExtraDto, { stockMinimo: 0 }),
      );
      expect(msgs.some((m) => m.includes('stockMinimo debe ser mayor a 0'))).toBe(
        true,
      );
    });

    it('acepta arrays vacios: es como se borra un bloque entero', async () => {
      const dto = plainToInstance(EditarExtraDto, {
        categoriaIds: [],
        precios: [],
        consumos: [],
      });
      expect(await errores(dto)).toEqual([]);
    });
  });
});
