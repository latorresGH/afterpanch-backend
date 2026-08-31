import { Body, Controller, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';

/** Topes por campo. El stack es el único que necesita margen grande. */
const LIMITES = {
  message: 500,
  stack: 8000,
  digest: 100,
  url: 1000,
  userAgent: 500,
  timestamp: 50,
} as const;

/**
 * Normaliza un campo del payload a string recortado, o `null`.
 *
 * TRUNCA en vez de rechazar, a propósito. Esto lo manda un navegador que acaba
 * de romperse: si un stack se pasa de largo, queremos los primeros 8000
 * caracteres —donde está el frame que importa— y no un 400 que nos deja sin
 * ningún dato. Misma lógica para tipos raros: si llega un número o un objeto,
 * lo pasamos a texto en vez de descartar el reporte entero.
 */
function texto(valor: unknown, max: number): string | null {
  if (valor === null || valor === undefined) return null;
  const s = typeof valor === 'string' ? valor : String(valor);
  const limpio = s.trim();
  if (!limpio) return null;
  return limpio.length > max ? `${limpio.slice(0, max)}…[truncado]` : limpio;
}

/**
 * 🔎 Telemetría de crashes del frontend.
 *
 * Existe por un caso concreto: un cliente anónimo del menú público hizo un
 * pedido que SÍ se creó en el backend, pero vio la pantalla "ALGO SALIÓ MAL"
 * del error boundary y volvió a pedir, quedando el pedido duplicado. El error
 * boundary solo hacía `console.error`, es decir que el stack trace se fue con
 * el navegador del cliente y nunca lo vimos.
 *
 * Este endpoint es el destino de ese reporte. NO persiste nada: escribe una
 * línea con prefijo `[CLIENT-ERROR]` para que salga por `docker logs`, que es
 * todo lo que hace falta para diagnosticar. Si en algún momento el volumen lo
 * justifica, acá se le puede enchufar una tabla.
 */
@ApiTags('Telemetry')
@Controller('telemetry')
export class TelemetryController {
  // El contexto del Logger es el módulo; el prefijo grepeable `[CLIENT-ERROR]`
  // va en el mensaje. Si estuviera en los dos lados, cada línea saldría con el
  // prefijo repetido.
  private readonly logger = new Logger(TelemetryController.name);

  /**
   * Público a propósito: quien más necesita reportar es justamente el cliente
   * anónimo del menú, que no tiene sesión. Exigir auth acá dejaría ciego el
   * único flujo que nos interesa observar.
   *
   * El throttle es el contrapeso de esa apertura: 20 por minuto por IP alcanza
   * de sobra para una página que se rompió (manda uno por crash) y evita que
   * alguien nos inunde los logs del contenedor.
   *
   * El body se recibe suelto (`Record<string, unknown>`) y NO como un DTO con
   * class-validator. No es descuido: el ValidationPipe global de `main.ts` corre
   * con `forbidNonWhitelisted: true`, así que un campo de más —o un stack más
   * largo que el límite— respondería 400 y perdería el reporte. Al no ser una
   * clase, el pipe global lo deja pasar y el saneo lo hace `texto()` acá abajo,
   * que recorta en lugar de rechazar. Al log solo llegan los campos conocidos.
   */
  @Post('error')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary: 'Reportar un crash del frontend',
    description:
      'Lo llama el error boundary del front. Público (los clientes anónimos ' +
      'también tienen que poder reportar) y sin persistencia: solo deja el ' +
      'error en los logs del contenedor con el prefijo [CLIENT-ERROR].',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: "Cannot read properties of undefined (reading 'reduce')" },
        stack: { type: 'string' },
        digest: { type: 'string', description: 'digest de Next.js, si lo hay' },
        url: { type: 'string', example: 'https://afterpanch.com.ar/pedido/abc' },
        userAgent: { type: 'string' },
        timestamp: { type: 'string', example: '2026-08-24T04:55:00.000Z' },
      },
    },
  })
  @ApiResponse({ status: 204, description: 'Reporte registrado en los logs' })
  reportarError(@Body() body: Record<string, unknown>): void {
    const payload = body ?? {};

    // Una sola línea con todo: es lo que se va a grepear en producción.
    // El stack va aparte porque es multilínea y arruinaría el grep del resto.
    this.logger.error(
      `[CLIENT-ERROR] ${JSON.stringify({
        digest: texto(payload.digest, LIMITES.digest),
        message: texto(payload.message, LIMITES.message),
        url: texto(payload.url, LIMITES.url),
        userAgent: texto(payload.userAgent, LIMITES.userAgent),
        timestamp:
          texto(payload.timestamp, LIMITES.timestamp) ??
          new Date().toISOString(),
      })}`,
    );

    const stack = texto(payload.stack, LIMITES.stack);
    if (stack) {
      this.logger.error(`[CLIENT-ERROR] stack:\n${stack}`);
    }
  }
}
