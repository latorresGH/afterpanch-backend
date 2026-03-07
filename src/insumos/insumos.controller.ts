import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from "@nestjs/common";
import { InsumosService } from "./insumos.service";
import { UpdateInsumoDto } from "./dto/update-insumo.dto";
import { SumarStockDto } from "./dto/sumar-stock.dto";
import { ToggleActivoDto } from "./dto/toggle-activo.dto";
import { DescontarStockDto } from "./dto/descontar-stock.dto";

@Controller("insumos")
export class InsumosController {
  constructor(private readonly insumosService: InsumosService) {}

  @Post()
  crear(@Body() body: { nombre: string; stockInicial: number; unidad: string; proveedorId?: string | null }) {
    return this.insumosService.crear(body.nombre, body.stockInicial, body.unidad, body.proveedorId ?? null);
  }

  // /insumos?incluirInactivos=true
  @Get()
  obtenerTodo(@Query("incluirInactivos") incluirInactivos?: string) {
    return this.insumosService.obtenerTodo(incluirInactivos === "true");
  }

  @Patch(":id")
  actualizar(@Param("id") id: string, @Body() dto: UpdateInsumoDto) {
    return this.insumosService.actualizar(id, dto);
  }

  @Patch(":id/sumar")
  sumarStock(@Param("id") id: string, @Body() dto: SumarStockDto) {
    return this.insumosService.sumarStock(id, dto.cantidad);
  }

  @Patch(":id/restar")
descontarStock(@Param("id") id: string, @Body() dto: DescontarStockDto) {
  return this.insumosService.descontarStock(id, dto.cantidad);
}

  // ✅ alta/baja lógica
  @Patch(":id/activo")
  setActivo(@Param("id") id: string, @Body() dto: ToggleActivoDto) {
    return this.insumosService.setActivo(id, dto.activo);
  }

  @Patch(":id/baja")
  baja(@Param("id") id: string) {
    return this.insumosService.setActivo(id, false);
  }

  @Patch(":id/alta")
  alta(@Param("id") id: string) {
    return this.insumosService.setActivo(id, true);
  }

  // ✅ delete real con reglas
  @Delete(":id")
  borrar(@Param("id") id: string) {
    return this.insumosService.borrar(id);
  }
}
