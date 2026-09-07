import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { HorarioDia } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Mendoza. El servidor corre en TZ de Buenos Aires: mismo offset, pero se
 *  deja explícito para no depender de que coincidan. */
const ZONA_HORARIA = 'America/Argentina/Mendoza';

/**
 * El cierre manual ("el local no toma pedidos"), que anula el horario entero.
 *
 * Vive como clave en `Configuracion` y no como tabla propia porque es un flag
 * global sin estructura. Lo que NO hace es viajar por el `POST /config/:clave`
 * genérico: esa ruta no tiene whitelist de claves y su upsert ciego es
 * exactamente lo que resucitó `stock_bajo_umbral` después de que una migración
 * la borrara. Se toca solo por `PATCH /admin/horario/forzado`, con su DTO.
 */
export const CLAVE_CERRADO_FORZADO = 'local_cerrado_forzado';

/**
 * Claves que tienen su propio endpoint con su propio DTO. El genérico las
 * rechaza para que el valor pase siempre por una validación de verdad.
 */
export const CLAVES_CON_ENDPOINT_PROPIO = new Set<string>([
  CLAVE_CERRADO_FORZADO,
]);

/**
 * Claves ELIMINADAS. Ya no las lee nadie y no pueden volver a existir.
 *
 * ⚠️ Esta lista es el cierre de un agujero real, no una precaución teórica.
 * `stock_bajo_umbral` la borró la migración 20260826020000 cuando el umbral
 * pasó a ser por insumo… y el panel viejo la resucitaba: `POST /config/:clave`
 * acepta cualquier nombre y hace un upsert ciego, así que cada "Guardar
 * umbral" la volvía a crear y el POS volvía a comparar el stock contra un
 * número global en vez de contra `Insumo.stockMinimo`. Borrarla sin cerrar
 * esta puerta ya se probó una vez y no alcanzó.
 *
 * `costo_envio_base` nunca la leyó nadie: se sembraba y quedaba ahí.
 */
export const CLAVES_ELIMINADAS = new Set<string>([
  'stock_bajo_umbral',
  'costo_envio_base',
]);

/**
 * Las tres claves del negocio que la pantalla de Ajustes edita.
 *
 * NO están en las listas de arriba a propósito: el panel VIEJO desplegado en
 * Vercel las escribe por `POST /config/:clave`, y bloquearlas lo dejaría sin
 * poder guardar nada. La pantalla nueva usa `PATCH /admin/config-negocio`,
 * que valida cada una con su tipo; el genérico queda como está hasta que el
 * frontend viejo salga de circulación.
 */
export const CLAVES_NEGOCIO = [
  'delivery_precio_base',
  'alias_transferencia',
  'whatsapp_numero',
] as const;

export type ClaveNegocio = (typeof CLAVES_NEGOCIO)[number];

/** 0=Lunes … 6=Domingo. Mismo índice que `HorarioDia.dia`. */
export const DIAS_SEMANA = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
] as const;

/** "HH:MM" de 24hs. El mismo que valida el DTO y el que usó la migración. */
const FORMATO_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Los que regían cuando el horario era global. Solo se usan como red. */
const HORA_APERTURA_HISTORICA = '21:00';
const HORA_CIERRE_HISTORICA = '23:30';

export type MotivoCierre = 'FORZADO' | 'DIA_CERRADO' | 'FUERA_DE_HORARIO';

/**
 * Lo que devuelve `estaAbierto()`.
 *
 * Los cuatro primeros campos son el contrato viejo, intacto: los leen
 * `GET /config/horario/abierto` (hooks/useConfig.ts del menú público) y el
 * bloque `local` del Home admin (components/admin/home/EstadoLocalHeader.tsx).
 * `horaApertura`/`horaCierre` ahora son el rango DE HOY en vez del global.
 *
 * El resto es nuevo y aditivo: nada de lo que existe hoy lo mira.
 */
export interface EstadoLocal {
  abierto: boolean;
  horaApertura: string | null;
  horaCierre: string | null;
  horaActual: string;
  /** Por qué está cerrado. `null` cuando está abierto. */
  motivo: MotivoCierre | null;
  /** Texto listo para mostrar/tirar. `null` cuando está abierto. */
  mensajeCierre: string | null;
  /** El toggle de cierre manual. */
  forzado: boolean;
  /** Si el día de hoy está marcado como abierto en el horario. */
  diaAbierto: boolean;
  /** 0=Lunes … 6=Domingo, en la zona horaria del negocio. */
  dia: number;
}

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

  // ─────────────────────────────────────────────────────────────────────────
  // Horario
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * ¿El local está abierto ahora?
   *
   * ⚠️ ESTA ES LA ÚNICA FUENTE DE VERDAD. Antes había dos: esta función y una
   * copia manual dentro de `PedidosService.crearPedido`, que releía las claves
   * y recalculaba todo a mano. Con dos definiciones el menú podía decir
   * "abierto" y la creación del pedido rechazarlo (o al revés). Si hace falta
   * saber si el local está abierto desde cualquier otro lado, se llama acá.
   *
   * El orden de evaluación importa:
   *
   * 1. FORZADO corta antes que nada. El toggle manual gana sobre el horario:
   *    si está en true el local está cerrado aunque sea el mediodía de un
   *    sábado. Y cierra de verdad — no solo el cartel: `crearPedido` tira
   *    sobre este mismo resultado.
   *
   * 2. FAIL-OPEN si el día de hoy no está configurado (no hay fila, o `desde`/
   *    `hasta` no son "HH:MM" válidos). Es preferible dejar entrar un pedido de
   *    más que cerrar el local por una config incompleta — el mismo criterio
   *    que ya regía cuando el horario era global y faltaba alguna de las dos
   *    claves. Esto es lo que mantiene sano un deploy a mitad de camino: si la
   *    tabla llegara vacía, el local queda abierto, nunca cerrado por error.
   *
   * 3. HORARIO, con el spillover de medianoche:
   *
   *      cruza(d) = mins(d.hasta) <= mins(d.desde)
   *      abierto  = ( hoy.abierto  && (cruza(hoy) ? ahora >= hoy.desde
   *                                               : hoy.desde <= ahora < hoy.hasta) )
   *              || ( ayer.abierto && cruza(ayer) && ahora < ayer.hasta )
   *
   *    El segundo término es el que el modelo global no podía expresar: el
   *    sábado abre 12:00 y cierra 01:30 del domingo, y el domingo abre 12:00.
   *    A la 01:00 del domingo el local está abierto POR EL TURNO DEL SÁBADO,
   *    aunque la fila del domingo diga que abre a las 12. Sin ese término el
   *    menú diría cerrado y `crearPedido` rechazaría el pedido.
   */
  async estaAbierto(ahora: Date = new Date()): Promise<EstadoLocal> {
    const { dia, minutos, horaActual } = this.momentoLocal(ahora);
    const diaAyer = (dia + 6) % 7;

    // Una sola ida a la DB para las dos cosas: el flag y los dos días. El
    // forzado se pide siempre (aunque corte después) para no pagar dos
    // round-trips en serie por el camino normal, que es el que corre en cada
    // carga del menú público.
    const [forzado, filas] = await Promise.all([
      this.getCerradoForzado(),
      this.prisma.horarioDia.findMany({
        where: { dia: { in: [dia, diaAyer] } },
      }),
    ]);

    const hoy = filas.find((f) => f.dia === dia) ?? null;
    const ayer = filas.find((f) => f.dia === diaAyer) ?? null;

    const rangoHoy = this.rangoValido(hoy);

    const base = {
      horaApertura: rangoHoy?.desde ?? null,
      horaCierre: rangoHoy?.hasta ?? null,
      horaActual,
      forzado,
      diaAbierto: hoy?.abierto ?? true,
      dia,
    };

    // 1. Cierre manual: gana sobre todo lo demás.
    if (forzado) {
      return {
        ...base,
        abierto: false,
        motivo: 'FORZADO',
        mensajeCierre:
          'Estamos cerrados temporalmente. No estamos tomando pedidos en este momento.',
      };
    }

    // 2. Sin configuración utilizable para hoy → abierto.
    if (!rangoHoy) {
      return {
        ...base,
        abierto: true,
        motivo: null,
        mensajeCierre: null,
      };
    }

    // 3. Horario del día + resto del turno de ayer.
    const dentroDeHoy =
      hoy!.abierto &&
      (rangoHoy.cruza
        ? minutos >= rangoHoy.desdeMin
        : minutos >= rangoHoy.desdeMin && minutos < rangoHoy.hastaMin);

    const rangoAyer = this.rangoValido(ayer);
    const restoDeAyer =
      !!rangoAyer &&
      ayer!.abierto &&
      rangoAyer.cruza &&
      minutos < rangoAyer.hastaMin;

    if (dentroDeHoy || restoDeAyer) {
      return { ...base, abierto: true, motivo: null, mensajeCierre: null };
    }

    // El día entero está marcado cerrado vs. estamos fuera de la franja: son
    // dos cosas distintas y el cartel del menú las dice distinto.
    const motivo: MotivoCierre = hoy!.abierto
      ? 'FUERA_DE_HORARIO'
      : 'DIA_CERRADO';

    return {
      ...base,
      abierto: false,
      motivo,
      mensajeCierre:
        motivo === 'DIA_CERRADO'
          ? 'Estamos cerrados. Hoy no abrimos.'
          : // Textual con el mensaje que tiraba `crearPedido` desde siempre.
            `Estamos cerrados. Horario de atención: ${rangoHoy.desde} a ${rangoHoy.hasta}`,
    };
  }

  /**
   * Las 7 filas del horario + el estado del toggle, para la pantalla del panel.
   *
   * Devuelve lo que hay persistido, ordenado por día. La migración crea los 7,
   * `dia` es único y no hay endpoint de borrado, así que en la práctica son
   * siempre 7; si alguien borrara una fila a mano, `estaAbierto` fail-opea ese
   * día y el `PATCH` lo vuelve a crear (es un upsert).
   */
  async getHorarioSemana(): Promise<{
    dias: HorarioDia[];
    forzado: boolean;
  }> {
    const [dias, forzado] = await Promise.all([
      this.prisma.horarioDia.findMany({ orderBy: { dia: 'asc' } }),
      this.getCerradoForzado(),
    ]);

    return { dias, forzado };
  }

  /**
   * Actualiza un día. Upsert: si la fila no existía (base a medio migrar,
   * borrado manual), la crea en vez de tirar 404.
   *
   * `desde === hasta` se rechaza a propósito. Con la regla de medianoche
   * (`hasta <= desde` ⇒ cruza) sería "abierto 24hs", pero escrito así es casi
   * siempre un dedazo — el que de verdad quiere todo el día pone 00:00 a 23:59
   * y no queda ambiguo.
   */
  async actualizarDia(
    dia: number,
    datos: { abierto: boolean; desde: string; hasta: string },
  ): Promise<HorarioDia> {
    if (!Number.isInteger(dia) || dia < 0 || dia > 6) {
      throw new BadRequestException(
        'El día tiene que ser un entero de 0 (Lunes) a 6 (Domingo)',
      );
    }

    if (datos.desde === datos.hasta) {
      throw new BadRequestException(
        'La hora de apertura y la de cierre no pueden ser la misma. Para abrir todo el día usá 00:00 a 23:59.',
      );
    }

    return this.prisma.horarioDia.upsert({
      where: { dia },
      update: {
        abierto: datos.abierto,
        desde: datos.desde,
        hasta: datos.hasta,
      },
      create: {
        dia,
        abierto: datos.abierto,
        desde: datos.desde,
        hasta: datos.hasta,
      },
    });
  }

  /** El toggle "el local no toma pedidos". Ausente se lee como apagado. */
  async getCerradoForzado(): Promise<boolean> {
    return (await this.obtener(CLAVE_CERRADO_FORZADO)) === 'true';
  }

  async setCerradoForzado(forzado: boolean): Promise<{ forzado: boolean }> {
    await this.establecer(
      CLAVE_CERRADO_FORZADO,
      forzado ? 'true' : 'false',
      'Cierre manual: si es true el local no toma pedidos, sin importar el horario',
    );

    return { forzado };
  }

  /**
   * Momento actual en la zona horaria del negocio: día de la semana, minutos
   * desde medianoche y el "HH:MM" para mostrar.
   *
   * Se calcula todo desde el MISMO `formatToParts`, así el día y la hora no
   * pueden salir de dos instantes distintos (que es lo que pasaba al pedir la
   * hora con `toLocaleTimeString` y el día con `getDay()`: el segundo usa la
   * TZ del proceso, no la del negocio, y cerca de medianoche difieren).
   *
   * `hourCycle: 'h23'` y no `hour12: false`: este último devuelve "24" para la
   * medianoche en varias versiones de ICU.
   */
  private momentoLocal(ahora: Date): {
    dia: number;
    minutos: number;
    horaActual: string;
  } {
    const partes = new Intl.DateTimeFormat('en-US', {
      timeZone: ZONA_HORARIA,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(ahora);

    const parte = (tipo: string) =>
      partes.find((p) => p.type === tipo)?.value ?? '';

    // en-US da "Mon".."Sun". Se mapea a 0=Lunes, que es el índice de
    // `HorarioDia.dia` (y el del mockup: `(getDay() + 6) % 7`).
    const indices: Record<string, number> = {
      Mon: 0,
      Tue: 1,
      Wed: 2,
      Thu: 3,
      Fri: 4,
      Sat: 5,
      Sun: 6,
    };

    const horas = Number(parte('hour')) % 24; // por si algún ICU devuelve 24
    const minutosDeLaHora = Number(parte('minute'));

    return {
      dia: indices[parte('weekday')] ?? 0,
      minutos: horas * 60 + minutosDeLaHora,
      horaActual: `${String(horas).padStart(2, '0')}:${String(
        minutosDeLaHora,
      ).padStart(2, '0')}`,
    };
  }

  /**
   * Normaliza una fila a algo con lo que se pueda comparar, o `null` si no se
   * puede confiar en ella (fila ausente, o texto que no es "HH:MM").
   *
   * El `null` es el que dispara el fail-open: un valor corrupto en la DB no
   * puede cerrar el local, igual que antes no lo cerraba una clave vacía.
   */
  private rangoValido(fila: HorarioDia | null): {
    desde: string;
    hasta: string;
    desdeMin: number;
    hastaMin: number;
    cruza: boolean;
  } | null {
    if (!fila) return null;
    if (!FORMATO_HORA.test(fila.desde) || !FORMATO_HORA.test(fila.hasta)) {
      return null;
    }

    const aMinutos = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + m;
    };

    const desdeMin = aMinutos(fila.desde);
    const hastaMin = aMinutos(fila.hasta);

    return {
      desde: fila.desde,
      hasta: fila.hasta,
      desdeMin,
      hastaMin,
      // Abre 19:00 y cierra 00:30 ⇒ el turno termina al día siguiente.
      cruza: hastaMin <= desdeMin,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Configuración del negocio (la pestaña de Ajustes)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Las tres claves que la pantalla de Ajustes edita, ya tipadas.
   *
   * Se leen de una sola query en vez de tres `obtener()` en serie, y se
   * devuelven con el tipo que el frontend necesita —el precio como number, no
   * como el string en el que Postgres lo guarda— para que no haya un
   * `parseInt` con fallback en cada pantalla que lo consuma. Ese patrón es el
   * que hoy tiene `useConfig` y el que hacía que un valor vacío se leyera como
   * 3000 sin que nadie se enterara.
   */
  async getConfigNegocio(): Promise<{
    deliveryPrecioBase: number;
    aliasTransferencia: string;
    whatsappNumero: string;
  }> {
    const filas = await this.prisma.configuracion.findMany({
      where: { clave: { in: [...CLAVES_NEGOCIO] } },
    });

    const valor = (clave: ClaveNegocio) =>
      filas.find((f) => f.clave === clave)?.valor ?? '';

    const precio = Number(valor('delivery_precio_base'));

    return {
      // Si la clave falta o quedó con basura, 0 y no un default inventado: el
      // panel muestra lo que hay de verdad y el usuario lo corrige.
      deliveryPrecioBase: Number.isFinite(precio) && precio >= 0 ? precio : 0,
      aliasTransferencia: valor('alias_transferencia'),
      whatsappNumero: valor('whatsapp_numero'),
    };
  }

  /**
   * Actualiza solo las claves que vengan en el body (PATCH parcial de verdad).
   *
   * Cada `upsert` va por su clave y el nombre NO sale de la request: sale de
   * este código. Es la diferencia con `POST /config/:clave`, que toma el
   * nombre de la URL y escribe lo que sea — la puerta por la que
   * `stock_bajo_umbral` volvía a existir.
   *
   * Van en una transacción: si el alias se guarda y el WhatsApp falla, el
   * panel quedaría mostrando un estado que no es ni el viejo ni el nuevo.
   */
  async actualizarConfigNegocio(datos: {
    deliveryPrecioBase?: number;
    aliasTransferencia?: string;
    whatsappNumero?: string;
  }) {
    const cambios: { clave: ClaveNegocio; valor: string; descripcion: string }[] =
      [];

    if (datos.deliveryPrecioBase !== undefined) {
      cambios.push({
        clave: 'delivery_precio_base',
        valor: String(datos.deliveryPrecioBase),
        descripcion: 'Precio base de delivery',
      });
    }
    if (datos.aliasTransferencia !== undefined) {
      cambios.push({
        clave: 'alias_transferencia',
        valor: datos.aliasTransferencia.trim(),
        descripcion: 'Alias para recibir transferencias',
      });
    }
    if (datos.whatsappNumero !== undefined) {
      cambios.push({
        clave: 'whatsapp_numero',
        // Se guarda solo dígitos: el frontend arma `wa.me/<numero>` haciendo
        // `.replace(/\D/g, '')` en CUATRO lugares distintos. Normalizar acá,
        // una vez, es lo que hace que esos cuatro puedan dejar de hacerlo.
        valor: datos.whatsappNumero.replace(/\D/g, ''),
        descripcion: 'Número de WhatsApp para contacto (con código de país)',
      });
    }

    if (cambios.length === 0) {
      return this.getConfigNegocio();
    }

    await this.prisma.$transaction(
      cambios.map((c) =>
        this.prisma.configuracion.upsert({
          where: { clave: c.clave },
          update: { valor: c.valor },
          create: { clave: c.clave, valor: c.valor, descripcion: c.descripcion },
        }),
      ),
    );

    return this.getConfigNegocio();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Configuración key/value
  // ─────────────────────────────────────────────────────────────────────────

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
      // ⚠️ LEGACY. El horario real vive en "HorarioDia" desde la migración
      // 20260904000000_horario_por_dia y NADIE en el backend lee estas dos
      // claves. Siguen sembrándose porque el frontend desplegado las lee
      // directo de GET /config (hooks/useConfig.ts, components/menu/
      // MenuHeader.tsx) y sin ellas mostraría su fallback hardcodeado. Se
      // borran de acá y de la DB recién cuando salga el frontend nuevo.
      {
        clave: 'hora_apertura',
        valor: HORA_APERTURA_HISTORICA,
        descripcion:
          '[LEGACY] Horario global. El horario real es por día, en HorarioDia.',
      },
      {
        clave: 'hora_cierre',
        valor: HORA_CIERRE_HISTORICA,
        descripcion:
          '[LEGACY] Horario global. El horario real es por día, en HorarioDia.',
      },
      {
        clave: CLAVE_CERRADO_FORZADO,
        valor: 'false',
        descripcion:
          'Cierre manual: si es true el local no toma pedidos, sin importar el horario',
      },
      // 'costo_envio_base' se ELIMINÓ (migración
      // 20260904120000_limpiar_claves_muertas). Se sembraba acá y no la leía
      // NADIE: el costo real sale de 'delivery_precio_base' para el pedido
      // público anónimo, del body para el empleado, o del sistema de envíos.
      // Si se volviera a sembrar, esta función la resucitaría — que es
      // exactamente lo que pasaba con 'stock_bajo_umbral' por otra vía.
      // Las dos están en CLAVES_ELIMINADAS.
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
