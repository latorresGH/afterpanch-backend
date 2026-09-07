import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Las guardas que evitan que alguien se quede afuera del sistema, o que el
 * sistema se quede sin dueño.
 *
 * Ninguna de estas existía: hasta este cambio un ADMIN podía desactivarse a sí
 * mismo (y quedar fuera del panel al request siguiente, porque
 * `JwtStrategy.validate` rechaza a los inactivos), bajarse el rol siendo el
 * único administrador, o borrar físicamente a un repartidor y llevarse puesto
 * el historial de sus pedidos.
 *
 * Van con test propio y no solo con revisión porque son regresiones que NO se
 * ven al usar la app: todo "funciona", y el daño aparece al request siguiente
 * o al mirar un pedido viejo.
 */
describe('UsersService — guardas de auto-protección', () => {
  let service: UsersService;
  let findUnique: jest.Mock;
  let update: jest.Mock;
  let count: jest.Mock;

  const ADMIN_A = 'admin-a';
  const ADMIN_B = 'admin-b';
  const TRABAJADOR = 'trabajador-1';

  beforeEach(async () => {
    update = jest.fn((args) => ({ id: args.where.id, ...args.data }));
    count = jest.fn().mockResolvedValue(0);
    findUnique = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: { user: { findUnique, update, count } },
        },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  /** El usuario que se va a editar. */
  const objetivo = (
    id: string,
    role: Role,
    activo = true,
    nombre = 'Alguien',
  ) => findUnique.mockResolvedValue({ id, role, activo, nombre });

  /** Cuántos OTROS admins activos hay además del objetivo. */
  const otrosAdmins = (n: number) => count.mockResolvedValue(n);

  describe('1. nadie se desactiva a sí mismo', () => {
    it('rechaza que un ADMIN se desactive, aunque haya otros admins', async () => {
      objetivo(ADMIN_A, Role.ADMIN);
      otrosAdmins(3);

      await expect(
        service.update(ADMIN_A, { activo: false }, ADMIN_A),
      ).rejects.toThrow(
        'No podés desactivar tu propio acceso. Pedile a otro administrador que lo haga.',
      );
      expect(update).not.toHaveBeenCalled();
    });

    it('rechaza también a un TRABAJADOR que se desactiva a sí mismo', async () => {
      // La guarda no es sobre el rol: es sobre quedarse sin acceso.
      objetivo(TRABAJADOR, Role.TRABAJADOR);

      await expect(
        service.update(TRABAJADOR, { activo: false }, TRABAJADOR),
      ).rejects.toThrow(BadRequestException);
      expect(update).not.toHaveBeenCalled();
    });

    it('SÍ deja desactivar a OTRO usuario', async () => {
      objetivo(TRABAJADOR, Role.TRABAJADOR);

      await expect(
        service.update(TRABAJADOR, { activo: false }, ADMIN_A),
      ).resolves.toBeDefined();
      expect(update).toHaveBeenCalled();
    });

    it('deja que uno se edite a sí mismo mientras no se desactive', async () => {
      objetivo(ADMIN_A, Role.ADMIN);

      await expect(
        service.update(ADMIN_A, { nombre: 'Nombre Nuevo' }, ADMIN_A),
      ).resolves.toBeDefined();
    });

    it('reactivarse no está bloqueado (no deja a nadie afuera)', async () => {
      objetivo(ADMIN_A, Role.ADMIN, false);

      await expect(
        service.update(ADMIN_A, { activo: true }, ADMIN_A),
      ).resolves.toBeDefined();
    });
  });

  describe('2. el último ADMIN no puede bajarse el rol', () => {
    it('rechaza si es el único admin activo', async () => {
      objetivo(ADMIN_A, Role.ADMIN);
      otrosAdmins(0);

      await expect(
        service.update(ADMIN_A, { role: Role.TRABAJADOR }, ADMIN_A),
      ).rejects.toThrow(/único administrador activo/);
      expect(update).not.toHaveBeenCalled();
    });

    it('lo permite si hay otro admin activo', async () => {
      objetivo(ADMIN_A, Role.ADMIN);
      otrosAdmins(1);

      await expect(
        service.update(ADMIN_A, { role: Role.TRABAJADOR }, ADMIN_A),
      ).resolves.toBeDefined();
    });

    it('cuenta solo admins ACTIVOS, y excluye al propio objetivo', async () => {
      objetivo(ADMIN_A, Role.ADMIN);
      otrosAdmins(1);

      await service.update(ADMIN_A, { role: Role.DELIVERY }, ADMIN_A);

      expect(count).toHaveBeenCalledWith({
        where: { role: Role.ADMIN, activo: true, id: { not: ADMIN_A } },
      });
    });

    it('no se dispara si el rol "cambia" al mismo que ya tenía', async () => {
      objetivo(ADMIN_A, Role.ADMIN);
      otrosAdmins(0);

      await expect(
        service.update(ADMIN_A, { role: Role.ADMIN }, ADMIN_A),
      ).resolves.toBeDefined();
      expect(count).not.toHaveBeenCalled();
    });
  });

  describe('3. el último ADMIN no puede quedar desactivado', () => {
    it('rechaza desactivar al último admin, aunque lo haga OTRO admin', async () => {
      // Mismo agujero que bajarse el rol, por otra puerta: da igual quién
      // apriete el botón, el sistema queda sin ningún administrador.
      objetivo(ADMIN_B, Role.ADMIN, true, 'Sofi');
      otrosAdmins(0);

      await expect(
        service.update(ADMIN_B, { activo: false }, ADMIN_A),
      ).rejects.toThrow(/Sofi es el único administrador activo/);
      expect(update).not.toHaveBeenCalled();
    });

    it('el mensaje es distinto cuando es la propia cuenta', async () => {
      objetivo(ADMIN_A, Role.ADMIN);
      otrosAdmins(0);

      await expect(
        service.update(ADMIN_A, { activo: false }, ADMIN_A),
      ).rejects.toThrow(/No podés desactivar tu propio acceso/);
    });

    it('lo permite si queda otro admin activo', async () => {
      objetivo(ADMIN_B, Role.ADMIN, true, 'Sofi');
      otrosAdmins(2);

      await expect(
        service.update(ADMIN_B, { activo: false }, ADMIN_A),
      ).resolves.toBeDefined();
    });

    it('desactivar a un NO-admin nunca consulta el conteo', async () => {
      objetivo(TRABAJADOR, Role.TRABAJADOR);

      await service.update(TRABAJADOR, { activo: false }, ADMIN_A);

      expect(count).not.toHaveBeenCalled();
    });

    it('un admin YA inactivo no dispara la guarda', async () => {
      // No hay nada que proteger: ya no contaba como salida de emergencia.
      objetivo(ADMIN_B, Role.ADMIN, false);

      await expect(
        service.update(ADMIN_B, { role: Role.TRABAJADOR }, ADMIN_A),
      ).resolves.toBeDefined();
      expect(count).not.toHaveBeenCalled();
    });
  });

  describe('remove(): ya no borra, desactiva', () => {
    it('hace un update de activo:false, nunca un delete', async () => {
      objetivo(TRABAJADOR, Role.TRABAJADOR);

      await service.remove(TRABAJADOR, ADMIN_A);

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TRABAJADOR },
          data: expect.objectContaining({ activo: false }),
        }),
      );
      // La prueba de fondo: el service ni siquiera tiene a mano un delete.
      expect((service as any).prisma.user.delete).toBeUndefined();
    });

    it('hereda la guarda de auto-protección', async () => {
      objetivo(ADMIN_A, Role.ADMIN);
      otrosAdmins(3);

      await expect(service.remove(ADMIN_A, ADMIN_A)).rejects.toThrow(
        /No podés desactivar tu propio acceso/,
      );
    });

    it('hereda la guarda del último admin', async () => {
      objetivo(ADMIN_B, Role.ADMIN, true, 'Sofi');
      otrosAdmins(0);

      await expect(service.remove(ADMIN_B, ADMIN_A)).rejects.toThrow(
        /único administrador activo/,
      );
    });
  });

  describe('lo que no cambió', () => {
    it('un usuario inexistente sigue dando 404', async () => {
      findUnique.mockResolvedValue(null);

      await expect(
        service.update('fantasma', { activo: false }, ADMIN_A),
      ).rejects.toThrow(NotFoundException);
    });

    it('el reseteo de contraseña por admin sigue funcionando', async () => {
      objetivo(TRABAJADOR, Role.TRABAJADOR);

      await service.update(TRABAJADOR, { password: 'nueva1234' }, ADMIN_A);

      const data = update.mock.calls[0][0].data;
      // Hasheada, nunca en claro.
      expect(data.password).toBeDefined();
      expect(data.password).not.toBe('nueva1234');
      expect(data.password.startsWith('$2')).toBe(true);
    });

    it('sin actor las guardas de "propia cuenta" no aplican, pero la del último admin sí', async () => {
      // Una llamada interna sin actor no puede ser "su propia cuenta", pero
      // dejar el sistema sin admin sigue estando prohibido.
      objetivo(ADMIN_A, Role.ADMIN);
      otrosAdmins(0);

      await expect(
        service.update(ADMIN_A, { activo: false }),
      ).rejects.toThrow(/único administrador activo/);
    });
  });
});
