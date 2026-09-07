import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { NegocioConfigController } from './config.controller';
import { CLAVE_CERRADO_FORZADO, NegocioConfigService } from './config.service';
import { PrismaService } from '../prisma/prisma.service';

describe('NegocioConfigController', () => {
  let controller: NegocioConfigController;
  let establecer: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NegocioConfigController],
      providers: [
        NegocioConfigService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    controller = module.get<NegocioConfigController>(NegocioConfigController);
    establecer = jest
      .spyOn(module.get(NegocioConfigService), 'establecer')
      .mockResolvedValue({} as any);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /config/:clave — claves reservadas', () => {
    it('sigue escribiendo las claves de siempre', async () => {
      await controller.establecer('alias_transferencia', { valor: 'nuevo' });

      expect(establecer).toHaveBeenCalledWith(
        'alias_transferencia',
        'nuevo',
        undefined,
      );
    });

    it.each(['stock_bajo_umbral', 'costo_envio_base'])(
      'rechaza "%s": es una clave ELIMINADA y no puede volver a existir',
      (clave) => {
        // Sin este guard, la migración que borra la clave no alcanza: el panel
        // viejo la resucitaba en cada "Guardar". Ya pasó una vez con
        // stock_bajo_umbral, y el POS volvió a comparar el stock contra un
        // umbral global divergente de Insumo.stockMinimo.
        expect(() => controller.establecer(clave, { valor: '10' })).toThrow(
          BadRequestException,
        );
        expect(establecer).not.toHaveBeenCalled();
      },
    );

    it.each(['delivery_precio_base', 'alias_transferencia', 'whatsapp_numero'])(
      'sigue aceptando "%s": el panel viejo desplegado las escribe',
      async (clave) => {
        await controller.establecer(clave, { valor: 'x' });
        expect(establecer).toHaveBeenCalledWith(clave, 'x', undefined);
      },
    );

    it('rechaza el cierre manual: tiene su propio endpoint con DTO', () => {
      // Esta ruta acepta cualquier clave con cualquier string y hace un upsert
      // ciego. Es por donde `stock_bajo_umbral` volvía a existir después de
      // que una migración la borrara. Un 'si' guardado acá se leería como
      // apagado y el local seguiría tomando pedidos sin que nadie se entere.
      expect(() =>
        controller.establecer(CLAVE_CERRADO_FORZADO, { valor: 'si' }),
      ).toThrow(BadRequestException);

      expect(establecer).not.toHaveBeenCalled();
    });
  });
});
