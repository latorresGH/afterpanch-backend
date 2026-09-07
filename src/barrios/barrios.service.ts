import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NegocioConfigService } from '../config/config.service';
import { CreateBarrioDto, UpdateBarrioDto } from './dto/barrio.dto';

/**
 * Último recurso si `delivery_precio_base` tampoco existiera.
 *
 * Es el mismo número que la clave trae sembrado por defecto. No debería
 * llegar a usarse nunca —la clave se siembra en cada arranque— pero un barrio
 * a medio crear por una config incompleta sería peor que un precio que el
 * panel deja a la vista para corregir.
 */
const PRECIO_ENVIO_ULTIMO_RECURSO = 3000;

@Injectable()
export class BarriosService {
  constructor(
    private prisma: PrismaService,
    private config: NegocioConfigService,
  ) {}

  /**
   * El precio con el que se crea un barrio cuando el body no trae ninguno.
   *
   * Se resuelve con `delivery_precio_base`, que es exactamente lo que se le
   * cobraría a ese pedido si el barrio no existiera: el fallback no inventa un
   * precio, usa el que ya regía. Se lee por `getConfigNegocio()`, el mismo
   * mecanismo que usa la pantalla de Ajustes, así que ya llega como número y
   * saneado (un valor vacío o corrupto en la DB da 0, no NaN).
   *
   * Los dos escalones —config y luego la constante— existen porque este
   * camino corre justamente cuando algo ya salió de lo previsto; encadenar
   * otra suposición sin red sería volver a apostar.
   */
  private async precioPorDefecto(): Promise<number> {
    try {
      const { deliveryPrecioBase } = await this.config.getConfigNegocio();
      if (Number.isFinite(deliveryPrecioBase) && deliveryPrecioBase > 0) {
        return deliveryPrecioBase;
      }
    } catch {
      // La config no se pudo leer. Se sigue igual: el alta del barrio no puede
      // depender de que una clave de configuración esté disponible.
    }

    return PRECIO_ENVIO_ULTIMO_RECURSO;
  }

  /**
   * Alta de un barrio.
   *
   * `precioEnvio` es opcional SOLO como red de seguridad (ver el DTO): el
   * formulario del panel lo exige siempre. Si un alta por otro camino llega
   * sin precio, se completa con el base en vez de tirar 400 o crear el barrio
   * en un estado inválido.
   *
   * Ojo con el `??`: tiene que ser el operador de nullish y no `||`, porque un
   * `precioEnvio: 0` es un valor legítimo —envío gratis a ese barrio— y con
   * `||` se lo comería el fallback, cobrando el precio base donde alguien
   * había decidido no cobrar nada.
   */
  async create(dto: CreateBarrioDto) {
    const existe = await this.prisma.barrio.findUnique({
      where: { nombre: dto.nombre.trim() },
    });
    if (existe) {
      throw new BadRequestException('Ya existe un barrio con ese nombre');
    }

    const precioEnvio = dto.precioEnvio ?? (await this.precioPorDefecto());

    return this.prisma.barrio.create({
      data: {
        nombre: dto.nombre.trim(),
        precioEnvio: Number(precioEnvio),
        activo: dto.activo ?? true,
      },
    });
  }

  async findAll(activo?: boolean) {
    const where = activo !== undefined ? { activo } : {};
    return this.prisma.barrio.findMany({
      where,
      orderBy: { nombre: 'asc' },
    });
  }

  async findOne(id: string) {
    const barrio = await this.prisma.barrio.findUnique({ where: { id } });
    if (!barrio) throw new NotFoundException('Barrio no encontrado');
    return barrio;
  }

  async update(id: string, dto: UpdateBarrioDto) {
    await this.findOne(id);

    const data: any = {};
    if (dto.nombre !== undefined) data.nombre = dto.nombre.trim();
    if (dto.precioEnvio !== undefined) data.precioEnvio = Number(dto.precioEnvio);
    if (dto.activo !== undefined) data.activo = Boolean(dto.activo);

    return this.prisma.barrio.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.barrio.delete({ where: { id } });
  }
}
