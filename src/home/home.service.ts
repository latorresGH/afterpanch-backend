import { Injectable } from '@nestjs/common';
import { CajaService } from '../caja/caja.service';
import { NegocioConfigService } from '../config/config.service';
import { InsumosService } from '../insumos/insumos.service';
import { OfertasService } from '../ofertas/ofertas.service';
import { PedidosService } from '../pedidos/pedidos.service';
import { PedidosGateway } from '../pedidos/pedidos.gateway';
import { UsersService } from '../users/users.service';
import { rangoDelDia } from '../common/helpers/fecha.helper';

/** Iniciales para el avatar del bloque "Equipo": "Sol Medina" → "SM". */
function iniciales(nombre: string): string {
  const partes = (nombre ?? '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

@Injectable()
export class HomeService {
  constructor(
    private readonly cajaService: CajaService,
    private readonly configService: NegocioConfigService,
    private readonly insumosService: InsumosService,
    private readonly ofertasService: OfertasService,
    private readonly pedidosService: PedidosService,
    private readonly pedidosGateway: PedidosGateway,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Todo lo que muestra el Home admin, en una sola request.
   *
   * Un endpoint y no ocho porque el front vive en Vercel y la API en Hetzner:
   * cada fetch server-side es un round trip completo. Acá se paga uno.
   *
   * No hay lógica de negocio propia: cada dato sale del service dueño de su
   * dominio, y todos los totales los calcula Postgres (`aggregate`/`$queryRaw`).
   * No queda ningún `findMany` + `reduce`.
   */
  async getHome(userSub: string) {
    const ahora = new Date();
    const { inicio, fin } = rangoDelDia(ahora);

    const [
      usuario,
      local,
      caja,
      pendienteCobro,
      pedidosAbiertos,
      deliveryPendientesConfirmar,
      staff,
      conectados,
      facturacionSemana,
      movimientosHoy,
      insumosBajoMinimo,
      ofertaVigente,
    ] = await Promise.all([
      this.usersService.findByIdOrNull(userSub),
      this.configService.estaAbierto(ahora),
      this.cajaService.getResumenAgregado(inicio, fin),
      this.pedidosService.getPendienteCobro(),
      this.pedidosService.listarActivos(),
      this.pedidosService.getDeliveryPendientesConfirmar(3),
      this.usersService.findStaffOperativo(),
      this.pedidosGateway.getStaffConectados(),
      this.pedidosService.getFacturacionPorDia(7, ahora),
      this.cajaService.getMovimientosDelRango(inicio, fin),
      this.insumosService.contarBajoMinimo(),
      this.ofertasService.getVigenteConVencimiento(ahora),
    ]);

    const pedidosDemorados = pedidosAbiertos.filter((p) => p.demorado).length;

    // Porcentaje de lo facturado que ya está cobrado. Se resuelve acá y no en
    // el cliente para que no haya dos fórmulas dando números distintos.
    const facturado = caja.cobrado + pendienteCobro;
    const pctCobrado =
      facturado > 0 ? Math.round((caja.cobrado / facturado) * 100) : 0;

    return {
      bienvenida: {
        // Solo LEE el flag. Lo marca POST /users/me/bienvenida-vista cuando
        // termina la animación: si lo marcara este GET, un prefetch de /admin
        // se comería el splash sin que nadie lo viera.
        mostrar: usuario ? !usuario.bienvenidaVista : false,
        nombre: usuario?.nombre ?? '',
      },

      local,

      caja: {
        ...caja,
        pendienteCobro,
        pctCobrado,
      },

      pedidosAbiertos: {
        total: pedidosAbiertos.length,
        demorados: pedidosDemorados,
        items: pedidosAbiertos,
      },

      deliveryPendientesConfirmar,

      equipo: staff.map((persona) => ({
        id: persona.id,
        nombre: persona.nombre,
        iniciales: iniciales(persona.nombre),
        role: persona.role,
        // Snapshot del momento del SSR: quién tiene abierta una pantalla con
        // la campanita. No se actualiza solo (ver PedidosGateway).
        conectado: conectados.has(persona.id),
      })),

      facturacionSemana,

      movimientosHoy,

      // Los tres avisos chicos de la esquina del Home. Van juntos porque se
      // muestran juntos, pero cada numero sale del service de su dominio:
      // aca no se calcula nada, solo se agrupa.
      alertas: {
        // El mismo numero que muestra "Pedidos abiertos": se cuenta una sola
        // vez sobre los activos que ya estan en memoria, sin query extra.
        pedidosDemorados,
        insumosBajoMinimo,
        ofertaVigente,
      },
    };
  }
}
