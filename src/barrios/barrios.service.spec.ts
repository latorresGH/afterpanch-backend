import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException } from '@nestjs/common';

import { BarriosService } from './barrios.service';
import { CreateBarrioDto } from './dto/barrio.dto';
import { NegocioConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * El fallback de precio del alta de barrios.
 *
 * Es una RED DE SEGURIDAD, no el flujo normal: el formulario del panel exige
 * el precio siempre y no deja guardar vacío. Esto cubre un alta por otro
 * camino —un script de carga, una migración, una integración— para que no
 * explote con un 400 ni deje el barrio en un estado inválido.
 */
describe('BarriosService — fallback de precio en el alta', () => {
  let service: BarriosService;
  let create: jest.Mock;
  let findUnique: jest.Mock;
  let getConfigNegocio: jest.Mock;

  beforeEach(async () => {
    create = jest.fn((args) => args.data);
    findUnique = jest.fn().mockResolvedValue(null);
    getConfigNegocio = jest.fn().mockResolvedValue({
      deliveryPrecioBase: 3200,
      aliasTransferencia: 'afterpanch.mp',
      whatsappNumero: '',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BarriosService,
        {
          provide: PrismaService,
          useValue: { barrio: { create, findUnique } },
        },
        { provide: NegocioConfigService, useValue: { getConfigNegocio } },
      ],
    }).compile();

    service = module.get(BarriosService);
  });

  const precioGuardado = () => create.mock.calls[0][0].data.precioEnvio;

  it('SIN precioEnvio usa delivery_precio_base en vez de tirar 400', async () => {
    // El caso que motiva todo esto: antes `Number(undefined)` daba NaN y el
    // alta reventaba (o guardaba basura). Ahora se completa con el base.
    await service.create({ nombre: 'Sin Precio' } as CreateBarrioDto);

    expect(getConfigNegocio).toHaveBeenCalledTimes(1);
    expect(precioGuardado()).toBe(3200);
  });

  it('CON precioEnvio respeta el del body y ni consulta la config', async () => {
    await service.create({
      nombre: 'Centro',
      precioEnvio: 2500,
    } as CreateBarrioDto);

    expect(precioGuardado()).toBe(2500);
    expect(getConfigNegocio).not.toHaveBeenCalled();
  });

  it('⚠️ precioEnvio 0 NO cae en el fallback: envío gratis es una decisión', async () => {
    // Con `||` en vez de `??` este caso cobraría el precio base justo donde
    // alguien había decidido no cobrar nada. Es el bug que el operador de
    // nullish evita, y por eso tiene test propio.
    await service.create({
      nombre: 'Gratis',
      precioEnvio: 0,
    } as CreateBarrioDto);

    expect(precioGuardado()).toBe(0);
    expect(getConfigNegocio).not.toHaveBeenCalled();
  });

  describe('cuando la config tampoco sirve', () => {
    it.each([
      ['el precio base es 0', 0],
      ['el precio base es negativo', -100],
      ['el precio base es NaN', NaN],
    ])('con %s cae al último recurso', async (_caso, deliveryPrecioBase) => {
      getConfigNegocio.mockResolvedValue({
        deliveryPrecioBase,
        aliasTransferencia: '',
        whatsappNumero: '',
      });

      await service.create({ nombre: 'Raro' } as CreateBarrioDto);

      expect(precioGuardado()).toBe(3000);
    });

    it('si leer la config TIRA, el alta igual funciona', async () => {
      // El alta de un barrio no puede depender de que una clave de
      // configuración esté disponible: este camino corre justamente cuando
      // algo ya salió de lo previsto.
      getConfigNegocio.mockRejectedValue(new Error('DB caída'));

      await expect(
        service.create({ nombre: 'Resiliente' } as CreateBarrioDto),
      ).resolves.toBeDefined();

      expect(precioGuardado()).toBe(3000);
    });
  });

  it('el fallback no saltea la validación de nombre duplicado', async () => {
    findUnique.mockResolvedValue({ id: 'x', nombre: 'Centro' });

    await expect(
      service.create({ nombre: 'Centro' } as CreateBarrioDto),
    ).rejects.toThrow(BadRequestException);

    expect(create).not.toHaveBeenCalled();
  });

  it('el resto del alta no cambió: nombre recortado y activo por defecto', async () => {
    await service.create({
      nombre: '  Alberdi  ',
      precioEnvio: 2800,
    } as CreateBarrioDto);

    expect(create.mock.calls[0][0].data).toEqual({
      nombre: 'Alberdi',
      precioEnvio: 2800,
      activo: true,
    });
  });
});

describe('CreateBarrioDto — precioEnvio opcional', () => {
  async function errores(dto: object): Promise<string[]> {
    const fallas = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return fallas.flatMap((f) => Object.values(f.constraints ?? {}));
  }

  it('acepta un alta SIN precioEnvio (antes era 400)', async () => {
    expect(
      await errores(plainToInstance(CreateBarrioDto, { nombre: 'Centro' })),
    ).toEqual([]);
  });

  it('sigue validando el precio CUANDO viene', async () => {
    for (const precioEnvio of [-1, 'gratis']) {
      const msgs = await errores(
        plainToInstance(CreateBarrioDto, { nombre: 'Centro', precioEnvio }),
      );
      expect(msgs.length).toBeGreaterThan(0);
    }
  });

  it('acepta 0 como precio válido', async () => {
    expect(
      await errores(
        plainToInstance(CreateBarrioDto, { nombre: 'Centro', precioEnvio: 0 }),
      ),
    ).toEqual([]);
  });

  it('el nombre sigue siendo obligatorio', async () => {
    const msgs = await errores(
      plainToInstance(CreateBarrioDto, { precioEnvio: 2500 }),
    );
    expect(msgs.length).toBeGreaterThan(0);
  });
});
