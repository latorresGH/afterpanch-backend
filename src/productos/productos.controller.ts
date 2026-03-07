import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from "@nestjs/common";
import { ProductosService } from "./productos.service";
import { UpdateProductoDto } from "./dto/update-producto.dto";
import { ToggleActivoDto } from "./dto/toggle-activo.dto";
import { CreateProductoDto } from "./dto/create-producto.dto";

@Controller("productos")
export class ProductosController {
  constructor(private readonly productosService: ProductosService) {}

  @Post()
  crear(@Body() body: CreateProductoDto) {
    return this.productosService.crearProductoConReceta(body);
  }

  @Get()
  obtenerTodos(@Query("incluirInactivos") incluirInactivos?: string) {
    return this.productosService.obtenerMenu(incluirInactivos === "true");
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.productosService.findOne(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateProductoDto) {
    return this.productosService.update(id, dto);
  }

  @Patch(":id/activo")
  setActivo(@Param("id") id: string, @Body() body: ToggleActivoDto) {
    return this.productosService.setActivo(id, body.activo);
  }

  @Patch(":id/baja")
  baja(@Param("id") id: string) {
    return this.productosService.setActivo(id, false);
  }

  @Patch(":id/alta")
  alta(@Param("id") id: string) {
    return this.productosService.setActivo(id, true);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.productosService.remove(id);
  }
}
