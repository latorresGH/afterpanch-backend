import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ExtrasService } from "./extras.service";
import { CreateExtraDto } from "./dto/create-extra.dto";
import { UpdateExtraDto } from "./dto/update-extra.dto";
import { ToggleActivoDto } from "./dto/toggle-activo.dto";
import { StockMovDto } from "./dto/stock-mov.dto";

@Controller("extras")
export class ExtrasController {
  constructor(private extras: ExtrasService) {}

  @Post()
  create(@Body() dto: CreateExtraDto) {
    return this.extras.create(dto);
  }

  @Get()
  findAll(
    @Query("incluirInactivos") incluirInactivos?: string,
    @Query("soloDisponibles") soloDisponibles?: string,
    @Query("categoria") categoria?: string,
  ) {
    return this.extras.findAll({
      incluirInactivos: incluirInactivos === "true",
      soloDisponibles: soloDisponibles === "true",
      categoria,
    });
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.extras.findOne(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateExtraDto) {
    return this.extras.update(id, dto);
  }

  @Patch(":id/activo")
  setActivo(@Param("id") id: string, @Body() dto: ToggleActivoDto) {
    return this.extras.setActivo(id, dto.activo);
  }

  @Patch(":id/sumar")
  sumar(@Param("id") id: string, @Body() dto: StockMovDto) {
    return this.extras.sumarStock(id, dto.cantidad);
  }

  @Patch(":id/descontar")
  descontar(@Param("id") id: string, @Body() dto: StockMovDto) {
    return this.extras.descontarStock(id, dto.cantidad);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.extras.remove(id);
  }
}