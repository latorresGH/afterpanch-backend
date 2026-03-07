import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from "@nestjs/common";
import { ProveedoresService } from "./proveedores.service";
import { CreateProveedorDto } from "./dto/create-proveedore.dto";
import { UpdateProveedorDto } from "./dto/update-proveedore.dto";
import { ToggleActivoDto } from "./dto/toggle-activo.dto";

@Controller("proveedores")
export class ProveedoresController {
  constructor(private readonly proveedoresService: ProveedoresService) {}

  @Post()
  crear(@Body() dto: CreateProveedorDto) {
    return this.proveedoresService.crear(dto);
  }

  // /proveedores?incluirInactivos=true
  @Get()
  listar(@Query("incluirInactivos") incluirInactivos?: string) {
    return this.proveedoresService.listar(incluirInactivos === "true");
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.proveedoresService.findOne(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateProveedorDto) {
    return this.proveedoresService.update(id, dto);
  }

  @Patch(":id/activo")
  setActivo(@Param("id") id: string, @Body() dto: ToggleActivoDto) {
    return this.proveedoresService.setActivo(id, dto.activo);
  }

  @Patch(":id/baja")
  baja(@Param("id") id: string) {
    return this.proveedoresService.setActivo(id, false);
  }

  @Patch(":id/alta")
  alta(@Param("id") id: string) {
    return this.proveedoresService.setActivo(id, true);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.proveedoresService.remove(id);
  }
}
