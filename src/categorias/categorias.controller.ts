import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CategoriasService } from './categorias.service';
import { CreateCategoriaDto } from './dto/create-categoria.dto';
import { UpdateCategoriaDto } from './dto/update-categoria.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { Public } from '../auth/public.decorator';

@ApiTags('Categorías')
@ApiBearerAuth()
@Controller('categorias')
export class CategoriasController {
  constructor(private readonly service: CategoriasService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Crear categoría',
    description: 'Crea una nueva categoría de productos.',
  })
  crear(@Body() dto: CreateCategoriaDto) {
    return this.service.crear(dto);
  }

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Listar categorías',
    description: 'Obtiene todas las categorías activas o todas según filtro.',
  })
  listar(@Query('incluirInactivas') incluirInactivas?: string) {
    return this.service.listar(incluirInactivas === 'true');
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  @ApiOperation({ summary: 'Obtener categoría por ID' })
  obtener(@Param('id') id: string) {
    return this.service.obtener(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Actualizar categoría' })
  actualizar(@Param('id') id: string, @Body() dto: UpdateCategoriaDto) {
    return this.service.actualizar(id, dto);
  }

  @Patch(':id/activo')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Cambiar estado activo de categoría' })
  setActivo(@Param('id') id: string, @Body() body: { activo: boolean }) {
    return this.service.setActivo(id, body.activo);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Eliminar categoría',
    description: 'Solo si no tiene productos asociados.',
  })
  borrar(@Param('id') id: string) {
    return this.service.borrar(id);
  }
}
