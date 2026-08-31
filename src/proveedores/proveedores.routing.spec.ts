import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from '@prisma/client';

import { AdminProveedoresController } from './admin-proveedores.controller';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { ROLES_KEY } from '../auth/roles.decorator';
import { AdminProveedoresQueryDto } from './dto/admin-proveedores-query.dto';
import {
  CrearProveedorDto,
  EditarProveedorDto,
} from './dto/admin-proveedor.dto';

/**
 * Quien puede llamar a que, y que forma tiene que tener lo que manda.
 *
 * Va cubierto por test y no solo por revision porque los dos lados son
 * regresiones silenciosas: un @Public() de mas expone la agenda de contactos
 * y las condiciones de compra del negocio, y un DTO que vuelva a rechazar el
 * string vacio deja de nuevo la pantalla sin poder dar de alta un proveedor
 * sin email.
 */
describe('Proveedores admin — rutas, permisos y validacion', () => {
  const proto = AdminProveedoresController.prototype;
  const roles = (metodo: any) => Reflect.getMetadata(ROLES_KEY, metodo);
  const esPublico = (metodo: any) =>
    Reflect.getMetadata(IS_PUBLIC_KEY, metodo) === true;

  /** Los mensajes de todas las restricciones que fallaron, aplanados. */
  async function errores(dto: object): Promise<string[]> {
    const fallas = await validate(dto, { whitelist: true });
    return fallas.flatMap((f) => Object.values(f.constraints ?? {}));
  }

  const todos = [
    proto.listar,
    proto.detalle,
    proto.crear,
    proto.editar,
    proto.archivar,
    proto.reactivar,
  ];

  describe('rutas y permisos', () => {
    it('cuelga de /admin/proveedores', () => {
      expect(Reflect.getMetadata('path', AdminProveedoresController)).toBe(
        'admin/proveedores',
      );
    });

    it('nada es publico', () => {
      expect(todos.some(esPublico)).toBe(false);
    });

    it('todo es solo ADMIN, lectura incluida', () => {
      // A diferencia de /admin/insumos, que es ADMIN + TRABAJADOR porque el
      // POS lo necesita: proveedores no lo consume nadie fuera del panel.
      for (const metodo of todos) {
        expect(roles(metodo)).toEqual([Role.ADMIN]);
      }
    });

    it('no expone ningun DELETE: "eliminar" en esta seccion es archivar', () => {
      const metodos = Object.getOwnPropertyNames(proto).filter(
        (n) => n !== 'constructor',
      );
      for (const nombre of metodos) {
        const verbo = Reflect.getMetadata('method', (proto as any)[nombre]);
        // 3 es DELETE en el enum RequestMethod de Nest.
        expect(verbo).not.toBe(3);
      }
      expect(metodos).toContain('archivar');
      expect(metodos).toContain('reactivar');
    });
  });

  describe('AdminProveedoresQueryDto', () => {
    it('acepta vacio: la pantalla arranca sin filtros', async () => {
      const dto = plainToInstance(AdminProveedoresQueryDto, {});
      expect(await errores(dto)).toEqual([]);
    });

    it('lee incluirArchivados como booleano aunque venga del query string', async () => {
      const dto = plainToInstance(AdminProveedoresQueryDto, {
        incluirArchivados: 'true',
      });

      expect(await errores(dto)).toEqual([]);
      expect(dto.incluirArchivados).toBe(true);

      const falso = plainToInstance(AdminProveedoresQueryDto, {
        incluirArchivados: 'false',
      });
      expect(falso.incluirArchivados).toBe(false);
    });

    it('rechaza un estado o un orden que no esten en el enum', async () => {
      const dto = plainToInstance(AdminProveedoresQueryDto, {
        estado: 'BORRADOS',
        orden: '; DROP TABLE "Proveedor"',
      });

      const msgs = await errores(dto);
      expect(msgs.some((m) => m.includes('estado debe ser uno de'))).toBe(true);
      expect(msgs.some((m) => m.includes('orden debe ser uno de'))).toBe(true);
    });

    it('clampea el pageSize por validacion, no en silencio', async () => {
      const dto = plainToInstance(AdminProveedoresQueryDto, {
        pageSize: 5000,
      });

      expect((await errores(dto)).some((m) => m.includes('pageSize'))).toBe(
        true,
      );
    });
  });

  describe('CrearProveedorDto', () => {
    it('con solo el nombre alcanza', async () => {
      const dto = plainToInstance(CrearProveedorDto, { nombre: 'Lacteos SR' });
      expect(await errores(dto)).toEqual([]);
    });

    it('acepta los campos vacios que manda un form HTML', async () => {
      // Este es el bug del DTO viejo: `@IsOptional()` no saltea el string
      // vacio, asi que `email: ""` reventaba con 400 y no se podia dar de
      // alta un proveedor sin email desde la pantalla.
      const dto = plainToInstance(CrearProveedorDto, {
        nombre: 'Congelados MG',
        telefono: '',
        email: '',
        notas: '',
      });

      expect(await errores(dto)).toEqual([]);
      expect(dto.telefono).toBeNull();
      expect(dto.email).toBeNull();
      expect(dto.notas).toBeNull();
    });

    it('recorta antes de validar: un nombre de puros espacios no pasa', async () => {
      const dto = plainToInstance(CrearProveedorDto, { nombre: '   ' });

      expect((await errores(dto)).some((m) => m.includes('obligatorio'))).toBe(
        true,
      );
    });

    it('recorta los espacios del nombre y del contacto', async () => {
      const dto = plainToInstance(CrearProveedorDto, {
        nombre: '  Lacteos SR  ',
        telefono: '  341 555 0088  ',
      });

      expect(dto.nombre).toBe('Lacteos SR');
      expect(dto.telefono).toBe('341 555 0088');
    });

    it('exige nombre', async () => {
      const dto = plainToInstance(CrearProveedorDto, { telefono: '341' });
      expect((await errores(dto)).some((m) => m.includes('obligatorio'))).toBe(
        true,
      );
    });

    it('valida el formato del email solo si vino algo', async () => {
      const malo = plainToInstance(CrearProveedorDto, {
        nombre: 'X',
        email: 'no-es-un-email',
      });
      expect(
        (await errores(malo)).some((m) => m.includes('formato valido')),
      ).toBe(true);

      const bueno = plainToInstance(CrearProveedorDto, {
        nombre: 'X',
        email: 'pedidos@dnorte.com.ar',
      });
      expect(await errores(bueno)).toEqual([]);
    });

    it('corta los textos largos', async () => {
      const dto = plainToInstance(CrearProveedorDto, {
        nombre: 'a'.repeat(200),
        notas: 'n'.repeat(600),
      });

      const msgs = await errores(dto);
      expect(msgs.some((m) => m.includes('nombre no puede superar'))).toBe(true);
      expect(msgs.some((m) => m.includes('notas no puede superar'))).toBe(true);
    });
  });

  describe('EditarProveedorDto', () => {
    it('un PATCH vacio es valido: no todos los campos se mandan siempre', async () => {
      const dto = plainToInstance(EditarProveedorDto, {});
      expect(await errores(dto)).toEqual([]);
    });

    it('el campo vacio borra el dato (null), el ausente queda undefined', async () => {
      const dto = plainToInstance(EditarProveedorDto, { telefono: '' });

      expect(await errores(dto)).toEqual([]);
      expect(dto.telefono).toBeNull();
      expect(dto.email).toBeUndefined();
    });

    it('si manda nombre, no puede ser vacio', async () => {
      const dto = plainToInstance(EditarProveedorDto, { nombre: '  ' });

      expect(
        (await errores(dto)).some((m) => m.includes('no puede quedar vacio')),
      ).toBe(true);
    });

    it('no acepta `activo`: archivar y reactivar son endpoints propios', async () => {
      const dto = plainToInstance(EditarProveedorDto, { activo: false });

      // Mismas opciones que el ValidationPipe global (`main.ts`): al no ser un
      // campo declarado del DTO, `forbidNonWhitelisted` lo rechaza con 400 en
      // vez de dejar que un PATCH de la ficha de baja a un proveedor de refilon.
      const fallas = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

      expect(
        fallas.flatMap((f) => Object.values(f.constraints ?? {})).join(' '),
      ).toMatch(/activo/);
    });
  });
});
