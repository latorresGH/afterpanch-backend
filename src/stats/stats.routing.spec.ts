import { Test } from '@nestjs/testing';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

/**
 * Que el controller quede colgado de /admin/estadisticas y que el DTO llegue
 * al service tal cual. El resto de la validacion la hace el ValidationPipe
 * global, que no se monta en un TestingModule.
 */
describe('StatsController — routing', () => {
  it('expone getEstadisticas pasando el query al service', async () => {
    const stats = { getEstadisticas: jest.fn().mockResolvedValue({ ok: true }) };

    const module = await Test.createTestingModule({
      controllers: [StatsController],
      providers: [{ provide: StatsService, useValue: stats }],
    }).compile();

    const controller = module.get(StatsController);
    await controller.getEstadisticas({ dias: 7 });

    expect(stats.getEstadisticas).toHaveBeenCalledWith({ dias: 7 });
  });

  it('la ruta es GET /admin/estadisticas y pide rol ADMIN', () => {
    const path = Reflect.getMetadata('path', StatsController);
    const subPath = Reflect.getMetadata(
      'path',
      StatsController.prototype.getEstadisticas,
    );
    const roles = Reflect.getMetadata(
      'roles',
      StatsController.prototype.getEstadisticas,
    );

    expect(`${path}/${subPath}`).toBe('admin/estadisticas');
    expect(roles).toEqual(['ADMIN']);
  });
});
