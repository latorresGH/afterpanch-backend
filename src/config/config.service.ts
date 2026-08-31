import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Mendoza. El servidor corre en TZ de Buenos Aires: mismo offset, pero se
 *  deja explícito para no depender de que coincidan. */
const ZONA_HORARIA = 'America/Argentina/Mendoza';

@Injectable()
export class NegocioConfigService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.inicializarPorDefecto();
  }

  async obtener(clave: string): Promise<string | null> {
    const config = await this.prisma.configuracion.findUnique({
      where: { clave },
    });
    return config?.valor || null;
  }

  /**
   * ¿El local está abierto ahora, según el horario configurado?
   *
   * Vivía en el controller (con 9 console.log por request). Se movió acá para
   * que el Home admin pueda reusar el MISMO cálculo en vez de repetirlo, y de
   * paso para que sea testeable sin levantar HTTP.
   *
   * Si falta alguno de los dos horarios se asume abierto: es preferible dejar
   * entrar un pedido de más a cerrar el local por una config incompleta.
   */
  async estaAbierto(ahora: Date = new Date()) {
    const [horaAperturaStr, horaCierreStr] = await Promise.all([
      this.obtener('hora_apertura'),
      this.obtener('hora_cierre'),
    ]);

    if (!horaAperturaStr || !horaCierreStr) {
      return {
        abierto: true,
        horaApertura: null,
        horaCierre: null,
        horaActual: null,
      };
    }

    const horaActualStr = ahora.toLocaleTimeString('es-AR', {
      timeZone: ZONA_HORARIA,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const aMinutos = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + (m || 0);
    };

    const actual = aMinutos(horaActualStr);
    const apertura = aMinutos(horaAperturaStr);
    const cierre = aMinutos(horaCierreStr);

    // El local abre 21:00 y cierra 23:30, pero también hay after de 05 a 08:
    // cuando el cierre es "menor" que la apertura, el turno cruza medianoche.
    const cruzaMedianoche = cierre < apertura;
    const abierto = cruzaMedianoche
      ? actual >= apertura || actual < cierre
      : actual >= apertura && actual < cierre;

    return {
      abierto,
      horaApertura: horaAperturaStr,
      horaCierre: horaCierreStr,
      horaActual: horaActualStr,
    };
  }

  async obtenerTodas() {
    return this.prisma.configuracion.findMany({
      orderBy: { clave: 'asc' },
    });
  }

  async establecer(clave: string, valor: string, descripcion?: string) {
    return this.prisma.configuracion.upsert({
      where: { clave },
      update: { valor, descripcion },
      create: { clave, valor, descripcion },
    });
  }

  async inicializarPorDefecto() {
    const defaults = [
      {
        clave: 'alias_transferencia',
        valor: 'afterpanch.mp',
        descripcion: 'Alias para recibir transferencias',
      },
      {
        clave: 'whatsapp_numero',
        valor: '',
        descripcion: 'Número de WhatsApp para contacto (con código de país)',
      },
      // 'stock_bajo_umbral' se ELIMINÓ: el umbral de stock bajo pasó a ser
      // por insumo ("Insumo"."stockMinimo"). Un insumo del que se venden 60
      // unidades por día y otro del que se usan 2 no pueden compartir umbral.
      // La migración 20260826020000_stock_minimo_por_insumo hace el backfill y
      // borra la clave; si se volviera a sembrar acá, la próxima llamada a
      // inicializarPorDefecto la resucitaría.
      {
        clave: 'delivery_precio_base',
        valor: '3000',
        descripcion: 'Precio base de delivery',
      },
      {
        clave: 'hora_apertura',
        valor: '21:00',
        descripcion: 'Hora de apertura del local (formato HH:MM)',
      },
      {
        clave: 'hora_cierre',
        valor: '23:30',
        descripcion: 'Hora de cierre del local (formato HH:MM)',
      },
      {
        clave: 'costo_envio_base',
        valor: '3000',
        descripcion: 'Costo base de envío (mostrado como estimado)',
      },
      {
        clave: 'demora_modo',
        valor: 'AUTO',
        descripcion: 'Modo de demora: AUTO (calcula según pedidos activos) o MANUAL (valor fijo)',
      },
      {
        clave: 'demora_manual_minutos',
        valor: '0',
        descripcion: 'Minutos de demora manual (solo se usa cuando demora_modo=MANUAL)',
      },
    ];

    for (const item of defaults) {
      const existe = await this.prisma.configuracion.findUnique({
        where: { clave: item.clave },
      });
      if (!existe) {
        console.log(`[Config] Creando valor por defecto: ${item.clave} = "${item.valor}"`);
        await this.prisma.configuracion.create({ data: item });
      }
    }
  }
}
