/**
 * Compara el trackingCode de un pedido contra el que manda quien pide acceso
 * (GET /pedidos/:id, agregar ítems a un pedidoId existente, o join-pedido del
 * WebSocket). Compartido entre PedidosService y PedidosGateway para no
 * duplicar la regla de acceso en dos lugares.
 *
 * Empleados (ADMIN/TRABAJADOR) y pedidos legacy (trackingCode null, creados
 * antes de introducir este campo) quedan exceptuados del chequeo.
 */
export function tieneAccesoTracking(
  trackingCode: string | null,
  code: string | undefined,
  esEmpleado?: boolean,
): boolean {
  if (esEmpleado) return true;
  if (trackingCode === null) return true;
  return code === trackingCode;
}
