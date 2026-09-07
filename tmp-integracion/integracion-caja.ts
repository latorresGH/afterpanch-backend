/**
 * Prueba de integracion contra Postgres real, fuera de Jest.
 *
 * No usa el e2e por HTTP porque ese suite se cae antes de llegar a caja
 * (POST /pedidos necesita datos sembrados de catalogo/envios que una base
 * limpia no tiene). Aca se instancia el CajaService de verdad contra una base
 * de verdad y se le insertan los pedidos a mano.
 *
 * Prueba dos cosas:
 *   A. La UNIQUE aguanta N confirmaciones concurrentes del mismo pedido.
 *   B. Los numeros de balance, ANTES vs DESPUES, sobre las MISMAS filas.
 */
import { PrismaClient, TipoMovimientoCaja } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CajaService, ActorCaja } from '../src/caja/caja.service';

const URL = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString: URL });
const prisma = new PrismaClient({ adapter });
const caja = new CajaService(prisma as any);

const SOL: ActorCaja = { id: 'u-sol', nombre: 'Sol Medina' };
const money = (n: number) =>
  n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 });

let fallos = 0;
function chequeo(nombre: string, ok: boolean, detalle = '') {
  console.log(`  ${ok ? 'OK  ' : 'FALLA'}  ${nombre}${detalle ? ' — ' + detalle : ''}`);
  if (!ok) fallos++;
}

/** Reproduce EXACTAMENTE el `obtenerResumenCaja` viejo (findMany + reduce). */
function resumenViejoPantallaCaja(movs: any[]) {
  const r = movs.reduce(
    (acc, mov) => {
      acc.totalEntradas += mov.tipo === 'ENTRADA' ? mov.montoTotal : 0;
      acc.totalSalidas += mov.tipo === 'SALIDA' ? mov.montoTotal : 0;
      acc.gananciaNegocioTotal += mov.gananciaNegocio;
      acc.gananciaRepartidorTotal += mov.gananciaRepartidor;
      return acc;
    },
    { totalEntradas: 0, totalSalidas: 0, gananciaNegocioTotal: 0, gananciaRepartidorTotal: 0, balance: 0 },
  );
  r.balance = r.totalEntradas - r.totalSalidas;
  return r;
}

/** Reproduce EXACTAMENTE el `getResumenAgregado` viejo (2 aggregates). */
function resumenViejoHome(movs: any[]) {
  const entradas = movs.filter((m) => m.tipo === 'ENTRADA');
  const cobrado = entradas.reduce((t, m) => t + m.montoTotal, 0);
  const salidas = movs.filter((m) => m.tipo === 'SALIDA').reduce((t, m) => t + m.montoTotal, 0);
  return { cobrado, entradas: cobrado, salidas, balance: cobrado - salidas, ticketsCerrados: entradas.length };
}

async function limpiar() {
  await prisma.cajaMovimiento.deleteMany({});
  await prisma.pedido.deleteMany({});
  await prisma.user.deleteMany({});
}

async function sembrarUsuario() {
  await prisma.user.create({
    data: { id: SOL.id, email: 'sol@test.local', password: 'x', nombre: SOL.nombre, role: 'TRABAJADOR' },
  });
}

async function sembrarPedido(id: string, total: number, costoEnvio: number) {
  await prisma.pedido.create({
    data: { id, tipo: 'DELIVERY', estado: 'ENTREGADO', total, costoEnvio },
  });
}

async function pruebaConcurrencia() {
  console.log('\n=== A. DOBLE COBRO: 8 confirmaciones concurrentes del mismo pedido ===');
  await limpiar();
  await sembrarUsuario();
  await sembrarPedido('p-race', 22000, 2800);

  const resultados = await Promise.allSettled(
    Array.from({ length: 8 }, () => caja.registrarPagoPedido('p-race', SOL)),
  );

  const oks = resultados.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
  const rechazados = resultados.filter((r) => r.status === 'rejected');
  const nuevos = oks.filter((r) => !r.value.yaExistia).length;
  const yaEstaban = oks.filter((r) => r.value.yaExistia).length;

  const enBase = await prisma.cajaMovimiento.findMany({ where: { pedidoId: 'p-race' } });

  console.log(`  8 requests -> ${oks.length} ok (${nuevos} nuevas, ${yaEstaban} "ya estaba"), ${rechazados.length} con error`);
  chequeo('quedo UN solo movimiento en la base', enBase.length === 1, `hay ${enBase.length}`);
  chequeo('exactamente una request inserto', nuevos === 1, `insertaron ${nuevos}`);
  chequeo('ninguna request tiro error', rechazados.length === 0);
  chequeo('la plata se conto una sola vez', enBase.reduce((t, m) => t + m.montoTotal, 0) === 24800);
  chequeo('el movimiento quedo atribuido al usuario del JWT', enBase[0]?.registradoPorId === SOL.id);
  if (rechazados.length) console.log('   motivos:', rechazados.map((r: any) => r.reason?.message));
}

async function pruebaBalance() {
  console.log('\n=== B. BALANCE: mismas filas, lector viejo vs lector nuevo ===');
  await limpiar();
  await sembrarUsuario();

  // Tres ventas cobradas.
  await sembrarPedido('p1', 22000, 2800);
  await sembrarPedido('p2', 19000, 2800);
  await sembrarPedido('p3', 31500, 0);
  for (const id of ['p1', 'p2', 'p3']) await caja.registrarPagoPedido(id, SOL);

  // Los gastos y ajustes se insertan COMO LOS ESCRIBIA EL CODIGO VIEJO
  // (gananciaNegocio = -monto en SALIDA, +monto en AJUSTE), que es el estado
  // en que puede estar la base hoy. Los dos lectores leen estas mismas filas.
  const viejo = (tipo: TipoMovimientoCaja, monto: number, desc: string) =>
    prisma.cajaMovimiento.create({
      data: {
        tipo,
        montoTotal: monto,
        gananciaNegocio: tipo === 'SALIDA' ? -monto : monto,
        gananciaRepartidor: 0,
        descripcion: desc,
        confirmadoPor: 'Admin',
        fechaConfirmacion: new Date(),
      },
    });

  await viejo('SALIDA', 11200, 'Pago a repartidor');
  await viejo('SALIDA', 42600, 'Insumos');
  await viejo('AJUSTE', -3000, 'Faltante de arqueo');

  const movs = await prisma.cajaMovimiento.findMany({});
  const antesCaja = resumenViejoPantallaCaja(movs);
  const antesHome = resumenViejoHome(movs);

  const ahoraCaja = (await caja.obtenerResumenCaja()).resumen;
  const desde = new Date(Date.now() - 86400000);
  const hasta = new Date(Date.now() + 86400000);
  const ahoraHome = await caja.getResumenAgregado(desde, hasta);

  console.log('\n  Movimientos del periodo:');
  console.log('    3 cobros de delivery ......... +' + money(24800 + 21800 + 31500));
  console.log('    pago a repartidor ............ -' + money(11200));
  console.log('    insumos ...................... -' + money(42600));
  console.log('    faltante de arqueo (AJUSTE) .. -' + money(3000));
  console.log('    ----------------------------------------------');
  console.log('    balance correcto a mano ...... ' + money(78100 - 11200 - 42600 - 3000));

  const fila = (etiqueta: string, a: any, b: any) =>
    console.log(
      `    ${etiqueta.padEnd(28)} ${String(money(a)).padStart(14)}  ${String(money(b)).padStart(14)}`,
    );

  console.log('\n  ANTES                              pantalla Caja      Home/Stats');
  fila('entradas', antesCaja.totalEntradas, antesHome.entradas);
  fila('salidas', antesCaja.totalSalidas, antesHome.salidas);
  fila('balance', antesCaja.balance, antesHome.balance);
  fila('ganancia negocio', antesCaja.gananciaNegocioTotal, NaN);

  console.log('\n  DESPUES                            pantalla Caja      Home/Stats');
  fila('entradas', ahoraCaja.totalEntradas, ahoraHome.entradas);
  fila('salidas', ahoraCaja.totalSalidas, ahoraHome.salidas);
  fila('balance', ahoraCaja.balance, ahoraHome.balance);
  fila('ganancia negocio', ahoraCaja.gananciaNegocioTotal, NaN);
  console.log(`    ${'cobrado (solo ventas)'.padEnd(28)} ${String(money(ahoraCaja.cobrado)).padStart(14)}  ${String(money(ahoraHome.cobrado)).padStart(14)}`);

  console.log('');
  // La doble resta no se veia en el `balance` (las dos formulas viejas hacian
  // entradas - salidas), se veia en el numero de "Negocio": los gastos y el
  // ajuste se le restaban ADEMAS de figurar en "Salidas".
  chequeo('ANTES: los gastos contaminaban la ganancia del negocio',
    antesCaja.gananciaNegocioTotal === 15700,
    `mostraba ${money(antesCaja.gananciaNegocioTotal)} en vez de ${money(72500)}`);
  chequeo('ANTES: ese mismo gasto ya estaba contado en salidas',
    antesCaja.totalSalidas === 53800, money(antesCaja.totalSalidas));
  chequeo('ANTES: el balance ignoraba el AJUSTE negativo en las DOS pantallas',
    antesCaja.balance === 24300 && antesHome.balance === 24300,
    `${money(24300)} en vez de ${money(21300)}`);
  chequeo('DESPUES: las dos pantallas coinciden', ahoraCaja.balance === ahoraHome.balance,
    `${money(ahoraCaja.balance)} las dos`);
  chequeo('DESPUES: el balance es el correcto a mano', ahoraCaja.balance === 21300, money(ahoraCaja.balance));
  chequeo('ANTES: el AJUSTE negativo no bajaba el balance', antesCaja.balance > 21300);
  chequeo('DESPUES: el AJUSTE negativo baja el balance', ahoraCaja.totalSalidas === 11200 + 42600 + 3000);
  chequeo('DESPUES: la ganancia del negocio no arrastra los gastos',
    ahoraCaja.gananciaNegocioTotal === 22000 + 19000 + 31500, money(ahoraCaja.gananciaNegocioTotal));

  // Un gasto escrito por el codigo NUEVO ya no ensucia gananciaNegocio.
  await caja.registrarMovimientoManual({ tipo: 'SALIDA', monto: 5000, descripcion: 'Gasto nuevo', actor: SOL });
  const nuevoGasto = await prisma.cajaMovimiento.findFirst({ where: { descripcion: 'Gasto nuevo' } });
  chequeo('un gasto nuevo guarda gananciaNegocio en 0', nuevoGasto?.gananciaNegocio === 0);
  chequeo('un gasto nuevo queda atribuido al usuario real', nuevoGasto?.registradoPorId === SOL.id);

  const finalCaja = (await caja.obtenerResumenCaja()).resumen;
  const finalHome = await caja.getResumenAgregado(desde, hasta);
  chequeo('siguen coincidiendo despues del gasto nuevo', finalCaja.balance === finalHome.balance,
    money(finalCaja.balance));

  // Donde las dos funciones viejas SI daban cosas distintas: una ENTRADA
  // manual (un fondo fijo) que el Home contaba como venta y como ticket.
  console.log('\n=== C. ENTRADA manual: "cobrado" no es lo mismo que "entradas" ===');
  await caja.registrarMovimientoManual({ tipo: 'ENTRADA', monto: 40000, descripcion: 'Fondo fijo', actor: SOL });

  const movsC = await prisma.cajaMovimiento.findMany({});
  const viejoC = resumenViejoHome(movsC);
  const nuevoC = await caja.getResumenAgregado(desde, hasta);

  console.log(`    ANTES:   cobrado ${money(viejoC.cobrado)} en ${viejoC.ticketsCerrados} "tickets" -> promedio ${money(Math.round(viejoC.cobrado / viejoC.ticketsCerrados))}`);
  console.log(`    DESPUES: cobrado ${money(nuevoC.cobrado)} en ${nuevoC.ticketsCerrados} tickets -> promedio ${money(nuevoC.ticketPromedio)}`);

  chequeo('ANTES: el fondo fijo se contaba como una venta mas',
    viejoC.ticketsCerrados === 4 && viejoC.cobrado === 118100);
  chequeo('DESPUES: solo las 3 ventas reales cuentan como ticket',
    nuevoC.ticketsCerrados === 3 && nuevoC.cobrado === 78100);
  chequeo('DESPUES: el fondo fijo igual entra a la caja',
    nuevoC.entradas === 118100, money(nuevoC.entradas));
}

(async () => {
  try {
    await pruebaConcurrencia();
    await pruebaBalance();
    console.log(fallos === 0 ? '\nTODO OK\n' : `\n${fallos} CHEQUEO(S) FALLADO(S)\n`);
  } catch (e: any) {
    console.error('EXPLOTO:', e);
    fallos++;
  } finally {
    await prisma.$disconnect();
    process.exit(fallos === 0 ? 0 : 1);
  }
})();
