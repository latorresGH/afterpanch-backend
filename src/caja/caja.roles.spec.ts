import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { CajaController } from './caja.controller';
import { ROLES_KEY } from '../auth/roles.decorator';

/**
 * Los roles de caja, leídos igual que los lee el RolesGuard en producción:
 * `getAllAndOverride([handler, class])`, donde el rol puesto en el método PISA
 * al de la clase.
 *
 * Ahí estaba el bug: la clase decía ADMIN + TRABAJADOR, pero los tres
 * endpoints de escritura decían solo ADMIN, y ganaban ellos. La pantalla de
 * caja del POS —que la usa un TRABAJADOR— llamaba a confirmar y se comía un
 * 403 en cada pedido: "Confirmar todos" mostraba "0 de 8 pagos confirmados".
 */
describe('CajaController — quién puede escribir en la caja', () => {
  const reflector = new Reflector();

  const rolesDe = (metodo: keyof CajaController) =>
    reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      CajaController.prototype[metodo] as any,
      CajaController,
    ]);

  describe('escritura: ADMIN y TRABAJADOR', () => {
    it.each([
      'confirmarPago',
      'confirmarLote',
      'registrarMovimientoManual',
    ] as const)('un TRABAJADOR puede llamar a %s', (metodo) => {
      const roles = rolesDe(metodo);

      expect(roles).toContain(Role.TRABAJADOR);
      expect(roles).toContain(Role.ADMIN);
    });

    it('ningún endpoint de escritura quedó restringido solo a ADMIN', () => {
      const escritura = [
        'confirmarPago',
        'confirmarLote',
        'registrarMovimientoManual',
      ] as const;

      const soloAdmin = escritura.filter((m) => {
        const roles = rolesDe(m);
        return roles?.length === 1 && roles[0] === Role.ADMIN;
      });

      expect(soloAdmin).toEqual([]);
    });
  });

  describe('lectura: sigue como estaba', () => {
    it.each(['obtenerResumen', 'getHistorial', 'obtenerMovimientosPorPedido'] as const)(
      '%s hereda ADMIN + TRABAJADOR de la clase',
      (metodo) => {
        expect(rolesDe(metodo)).toEqual([Role.ADMIN, Role.TRABAJADOR]);
      },
    );
  });

  it('caja sigue cerrada para DELIVERY y para cualquier otro rol', () => {
    const todos = [
      'confirmarPago',
      'confirmarLote',
      'registrarMovimientoManual',
      'obtenerResumen',
      'getHistorial',
      'obtenerMovimientosPorPedido',
    ] as const;

    for (const metodo of todos) {
      expect(rolesDe(metodo)).not.toContain(Role.DELIVERY);
    }
  });
});
