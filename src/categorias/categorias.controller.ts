import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CategoriasService } from "./categorias.service";
import { CreateCategoriaDto } from "./dto/create-categoria.dto";
import { UpdateCategoriaDto } from "./dto/update-categoria.dto";

@Controller("categorias")
export class CategoriasController {
  constructor(private readonly service: CategoriasService) {}

  @Post()
  crear(@Body() dto: CreateCategoriaDto) {
    return this.service.crear(dto);
  }

  // /categorias?incluirInactivas=true
  @Get()
  listar(@Query("incluirInactivas") incluirInactivas?: string) {
    return this.service.listar(incluirInactivas === "true");
  }

  @Get(":id")
  obtener(@Param("id") id: string) {
    return this.service.obtener(id);
  }

  @Patch(":id")
  actualizar(@Param("id") id: string, @Body() dto: UpdateCategoriaDto) {
    return this.service.actualizar(id, dto);
  }

  @Patch(":id/activo")
  setActivo(@Param("id") id: string, @Body() body: { activo: boolean }) {
    return this.service.setActivo(id, body.activo);
  }

  // delete real (bloqueado si tiene productos)
  @Delete(":id")
  borrar(@Param("id") id: string) {
    return this.service.borrar(id);
  }
}
