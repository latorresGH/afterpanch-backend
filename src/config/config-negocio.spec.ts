import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from '@prisma/client';

import {
  CLAVES_ELIMINADAS,
  CLAVES_CON_ENDPOINT_PROPIO,
  NegocioConfigService,
} from './config.service';
import { AdminConfigNegocioController } from './admin-config-negocio.controller';
import { ActualizarConfigNegocioDto } from './dto/config-negocio.dto';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { ROLES_KEY } from '../auth/roles.decorator';

describe('Configuración del negocio', () => {
  let service: NegocioConfigService;
  let findMany: jest.Mock;
  let upsert: jest.Mock;
  let transaction: jest.Mock;

  beforeEach(async () => {
    findMany = jest.fn().mockResolvedValue([]);
    upsert = jest.fn((args) => args);
    transaction = jest.fn().mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NegocioConfigService,
        {
          provide: PrismaService,
          useValue: {
            configuracion: { findMany, upsert },
            horarioDia: {},
            $transaction: transaction,
          },
        },
      ],
    }).compile();

    service = module.get(NegocioConfigService);
  });

  const filas = (pares: Record<string, string>) =>
    findMany.mockResolvedValue(
      Object.entries(pares).map(([clave, valor]) => ({ clave, valor })),
    );

  describe('getConfigNegocio', () => {
    it('devuelve las tres claves, con el precio ya como número', async () => {
      filas({
        delivery_precio_base: '3000',
        alias_transferencia: 'afterpanch.mp',
        whatsapp_numero: '5491123456789',
      });

      await expect(service.getConfigNegocio()).resolves.toEqual({
        deliveryPrecioBase: 3000,
        aliasTransferencia: 'afterpanch.mp',
        whatsappNumero: '5491123456789',
      });
    });

    it('pide SOLO esas tres claves', async () => {
      filas({});
      await service.getConfigNegocio();

      expect(findMany).toHaveBeenCalledWith({
        where: {
          clave: {
            in: [
              'delivery_precio_base',
              'alias_transferencia',
              'whatsapp_numero',
            ],
          },
        },
      });
    });

    it.each([
      ['', 0],
      ['tres mil', 0],
      ['-5', 0],
      ['2500', 2500],
    ])(
      'un precio guardado como "%s" se lee como %s',
      async (guardado, esperado) => {
        // Sin defaults inventados: si el valor está roto se devuelve 0 y el
        // panel muestra lo que hay de verdad. El `|| '3000'` de useConfig
        // hacía que un valor vacío se leyera como 3000 sin que nadie se
        // enterara.
        filas({ delivery_precio_base: guardado });
        const res = await service.getConfigNegocio();
        expect(res.deliveryPrecioBase).toBe(esperado);
      },
    );

    it('con las claves ausentes no explota', async () => {
      filas({});
      await expect(service.getConfigNegocio()).resolves.toEqual({
        deliveryPrecioBase: 0,
        aliasTransferencia: '',
        whatsappNumero: '',
      });
    });
  });

  describe('actualizarConfigNegocio', () => {
    beforeEach(() => filas({}));

    it('actualiza SOLO lo que viene en el body', async () => {
      await service.actualizarConfigNegocio({ aliasTransferencia: 'nuevo.mp' });

      expect(upsert).toHaveBeenCalledTimes(1);
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { clave: 'alias_transferencia' } }),
      );
    });

    it('los nombres de las claves salen del código, nunca del request', async () => {
      await service.actualizarConfigNegocio({
        deliveryPrecioBase: 4000,
        aliasTransferencia: 'x',
        whatsappNumero: '5491123456789',
      });

      const claves = upsert.mock.calls.map((c) => c[0].where.clave).sort();
      expect(claves).toEqual([
        'alias_transferencia',
        'delivery_precio_base',
        'whatsapp_numero',
      ]);
    });

    it('va en una transacción: no deja medio guardado', async () => {
      await service.actualizarConfigNegocio({
        aliasTransferencia: 'a',
        whatsappNumero: '5491123456789',
      });

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(transaction.mock.calls[0][0]).toHaveLength(2);
    });

    it('normaliza el WhatsApp a solo dígitos', async () => {
      // El frontend hace `.replace(/\D/g, '')` en cuatro lugares distintos
      // para armar el wa.me. Normalizando al guardar, esos cuatro pueden dejar
      // de hacerlo.
      await service.actualizarConfigNegocio({
        whatsappNumero: '+54 9 11 2345-6789',
      });

      expect(upsert.mock.calls[0][0].update.valor).toBe('5491123456789');
    });

    it('acepta el WhatsApp vacío: así se apaga el botón del menú', async () => {
      await service.actualizarConfigNegocio({ whatsappNumero: '' });
      expect(upsert.mock.calls[0][0].update.valor).toBe('');
    });

    it('recorta el alias', async () => {
      await service.actualizarConfigNegocio({
        aliasTransferencia: '  afterpanch.mp  ',
      });
      expect(upsert.mock.calls[0][0].update.valor).toBe('afterpanch.mp');
    });

    it('el precio se guarda como string (la columna es text)', async () => {
      await service.actualizarConfigNegocio({ deliveryPrecioBase: 3500 });
      expect(upsert.mock.calls[0][0].update.valor).toBe('3500');
    });

    it('con un body vacío no escribe nada', async () => {
      await service.actualizarConfigNegocio({});
      expect(upsert).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });

    it('devuelve la config completa ya actualizada', async () => {
      filas({ delivery_precio_base: '4000', alias_transferencia: 'nuevo' });

      await expect(
        service.actualizarConfigNegocio({ deliveryPrecioBase: 4000 }),
      ).resolves.toMatchObject({
        deliveryPrecioBase: 4000,
        aliasTransferencia: 'nuevo',
      });
    });
  });
});

describe('Config negocio — rutas, permisos y validación', () => {
  const proto = AdminConfigNegocioController.prototype;
  const roles = (metodo: any) => Reflect.getMetadata(ROLES_KEY, metodo);
  const esPublico = (metodo: any) =>
    Reflect.getMetadata(IS_PUBLIC_KEY, metodo) === true;

  async function errores(dto: object): Promise<string[]> {
    const fallas = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return fallas.flatMap((f) => Object.values(f.constraints ?? {}));
  }

  describe('rutas y permisos', () => {
    it('cuelga de /admin/config-negocio', () => {
      expect(Reflect.getMetadata('path', AdminConfigNegocioController)).toBe(
        'admin/config-negocio',
      );
    });

    it('nada es público y todo es solo ADMIN', () => {
      for (const metodo of [proto.get, proto.actualizar]) {
        expect(esPublico(metodo)).toBe(false);
        expect(roles(metodo)).toEqual([Role.ADMIN]);
      }
    });
  });

  describe('ActualizarConfigNegocioDto', () => {
    it('acepta un body vacío: es un PATCH parcial', async () => {
      expect(
        await errores(plainToInstance(ActualizarConfigNegocioDto, {})),
      ).toEqual([]);
    });

    it('acepta los tres campos válidos', async () => {
      expect(
        await errores(
          plainToInstance(ActualizarConfigNegocioDto, {
            deliveryPrecioBase: 3000,
            aliasTransferencia: 'afterpanch.mp',
            whatsappNumero: '5491123456789',
          }),
        ),
      ).toEqual([]);
    });

    it.each([
      ['un precio negativo', { deliveryPrecioBase: -1 }],
      ['un precio con decimales', { deliveryPrecioBase: 3000.5 }],
      ['un precio como texto', { deliveryPrecioBase: 'tres mil' }],
    ])('rechaza %s', async (_caso, patch) => {
      const msgs = await errores(
        plainToInstance(ActualizarConfigNegocioDto, patch),
      );
      expect(msgs.some((m) => m.includes('deliveryPrecioBase'))).toBe(true);
    });

    it('rechaza un WhatsApp que no parece un número', async () => {
      const msgs = await errores(
        plainToInstance(ActualizarConfigNegocioDto, {
          whatsappNumero: 'llamame',
        }),
      );
      expect(msgs.some((m) => m.includes('whatsappNumero'))).toBe(true);
    });

    it('acepta el WhatsApp vacío y con separadores', async () => {
      for (const whatsappNumero of [
        '',
        '+54 9 11 2345-6789',
        '5491123456789',
      ]) {
        expect(
          await errores(
            plainToInstance(ActualizarConfigNegocioDto, { whatsappNumero }),
          ),
        ).toEqual([]);
      }
    });

    it('rechaza una clave que no sea de las tres', async () => {
      // Esto es lo que convierte al DTO en una whitelist real: no hay forma de
      // colar una cuarta clave, que es justo lo que permite POST /config/:clave.
      const msgs = await errores(
        plainToInstance(ActualizarConfigNegocioDto, {
          stock_bajo_umbral: '10',
        } as object),
      );
      expect(msgs.length).toBeGreaterThan(0);
    });
  });
});

describe('Claves muertas y protegidas', () => {
  it('stock_bajo_umbral y costo_envio_base están marcadas como eliminadas', () => {
    expect(CLAVES_ELIMINADAS.has('stock_bajo_umbral')).toBe(true);
    expect(CLAVES_ELIMINADAS.has('costo_envio_base')).toBe(true);
  });

  it('las tres claves del negocio NO están bloqueadas', () => {
    // El panel viejo desplegado las escribe por POST /config/:clave. Si se
    // bloquearan, se quedaría sin poder guardar hasta que salga el nuevo.
    for (const clave of [
      'delivery_precio_base',
      'alias_transferencia',
      'whatsapp_numero',
    ]) {
      expect(CLAVES_ELIMINADAS.has(clave)).toBe(false);
      expect(CLAVES_CON_ENDPOINT_PROPIO.has(clave)).toBe(false);
    }
  });

  it('las claves de demora siguen libres: se editan desde otra pantalla', () => {
    for (const clave of ['demora_modo', 'demora_manual_minutos']) {
      expect(CLAVES_ELIMINADAS.has(clave)).toBe(false);
      expect(CLAVES_CON_ENDPOINT_PROPIO.has(clave)).toBe(false);
    }
  });
});
