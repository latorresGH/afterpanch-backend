import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from '@prisma/client';

import { AdminHorarioController } from './admin-horario.controller';
import { NegocioConfigController } from './config.controller';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { ROLES_KEY } from '../auth/roles.decorator';
import {
  ActualizarForzadoDto,
  ActualizarHorarioDiaDto,
} from './dto/horario.dto';

/**
 * Quién puede llamar a qué, y qué forma tiene que tener lo que manda.
 *
 * Va cubierto por test y no solo por revisión porque son regresiones
 * silenciosas: un @Public() de más en /admin/horario deja que cualquiera
 * cierre el local, y un `desde` que deje de validar formato mete en la DB un
 * valor que `estaAbierto` no sabe leer — y como el fail-open deja el local
 * ABIERTO, la falla no se vería hasta que entre un pedido fuera de hora.
 */
describe('Horario admin — rutas, permisos y validación', () => {
  const proto = AdminHorarioController.prototype;
  const roles = (metodo: any) => Reflect.getMetadata(ROLES_KEY, metodo);
  const esPublico = (metodo: any) =>
    Reflect.getMetadata(IS_PUBLIC_KEY, metodo) === true;

  async function errores(dto: object): Promise<string[]> {
    const fallas = await validate(dto, { whitelist: true });
    return fallas.flatMap((f) =>
      Object.values(f.constraints ?? {}),
    ) as string[];
  }

  const todos = [proto.getSemana, proto.setForzado, proto.actualizarDia];

  describe('rutas y permisos', () => {
    it('cuelga de /admin/horario', () => {
      expect(Reflect.getMetadata('path', AdminHorarioController)).toBe(
        'admin/horario',
      );
    });

    it('nada del panel es público', () => {
      expect(todos.some(esPublico)).toBe(false);
    });

    it('todo es solo ADMIN, lectura incluida', () => {
      for (const metodo of todos) {
        expect(roles(metodo)).toEqual([Role.ADMIN]);
      }
    });

    it('`forzado` se declara ANTES que `:dia`', () => {
      // Si `:dia` ganara el orden, PATCH /admin/horario/forzado entraría por el
      // parámetro y el ParseIntPipe respondería 400. Es el mismo caso que
      // users/me/bienvenida-vista, y no se ve en review.
      const metodos = Object.getOwnPropertyNames(proto).filter(
        (n) => n !== 'constructor',
      );
      expect(metodos.indexOf('setForzado')).toBeLessThan(
        metodos.indexOf('actualizarDia'),
      );
      expect(Reflect.getMetadata('path', proto.setForzado)).toBe('forzado');
      expect(Reflect.getMetadata('path', proto.actualizarDia)).toBe(':dia');
    });

    it('el endpoint que consume el menú público sigue siendo público', () => {
      // `GET /config/horario/abierto` lo llama hooks/useConfig.ts sin sesión.
      // Si dejara de ser público, el menú entero deja de saber si está abierto.
      expect(esPublico(NegocioConfigController.prototype.estaAbierto)).toBe(
        true,
      );
    });
  });

  describe('ActualizarHorarioDiaDto', () => {
    const valido = { abierto: true, desde: '19:00', hasta: '00:30' };

    it('acepta un turno que cruza la medianoche', async () => {
      expect(
        await errores(plainToInstance(ActualizarHorarioDiaDto, valido)),
      ).toEqual([]);
    });

    it('exige los tres campos: un PATCH parcial dejaría el día a medias', async () => {
      const msgs = await errores(plainToInstance(ActualizarHorarioDiaDto, {}));
      expect(msgs.some((m) => m.includes('abierto'))).toBe(true);
      expect(msgs.some((m) => m.includes('desde'))).toBe(true);
      expect(msgs.some((m) => m.includes('hasta'))).toBe(true);
    });

    it.each([
      ['9:00', 'sin cero a la izquierda'],
      ['25:00', 'hora fuera de rango'],
      ['19:60', 'minutos fuera de rango'],
      ['19:00:00', 'con segundos'],
      ['nueve', 'texto'],
      ['', 'vacío'],
    ])('rechaza desde = "%s" (%s)', async (desde) => {
      const msgs = await errores(
        plainToInstance(ActualizarHorarioDiaDto, { ...valido, desde }),
      );
      expect(msgs.some((m) => m.startsWith('desde tiene que ser'))).toBe(true);
    });

    it('rechaza un `hasta` mal formado', async () => {
      const msgs = await errores(
        plainToInstance(ActualizarHorarioDiaDto, { ...valido, hasta: '24:00' }),
      );
      expect(msgs.some((m) => m.startsWith('hasta tiene que ser'))).toBe(true);
    });

    it('rechaza `abierto` que no sea boolean', async () => {
      const msgs = await errores(
        plainToInstance(ActualizarHorarioDiaDto, { ...valido, abierto: 'si' }),
      );
      expect(msgs).toContain('abierto tiene que ser true o false');
    });

    it('acepta 00:00 y 23:59 (el "todo el día" sin ambigüedad)', async () => {
      expect(
        await errores(
          plainToInstance(ActualizarHorarioDiaDto, {
            abierto: true,
            desde: '00:00',
            hasta: '23:59',
          }),
        ),
      ).toEqual([]);
    });
  });

  describe('ActualizarForzadoDto', () => {
    it('acepta un boolean', async () => {
      expect(
        await errores(plainToInstance(ActualizarForzadoDto, { forzado: true })),
      ).toEqual([]);
    });

    it.each(['true', 1, null, undefined])(
      'rechaza %s: el valor va a una clave string y "si" se leería como apagado',
      async (forzado) => {
        const msgs = await errores(
          plainToInstance(ActualizarForzadoDto, { forzado }),
        );
        expect(msgs).toContain('forzado tiene que ser true o false');
      },
    );
  });
});
