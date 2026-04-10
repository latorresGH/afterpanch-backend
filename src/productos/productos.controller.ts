import {
  Controller,
  Post,
  Body,
  Get,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ProductosService } from './productos.service';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { ToggleActivoDto } from './dto/toggle-activo.dto';
import { CreateProductoDto } from './dto/create-producto.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { Public } from '../auth/public.decorator';

@ApiTags('Productos')
@ApiBearerAuth()
@Controller('productos')
export class ProductosController {
  constructor(private readonly productosService: ProductosService) {}

  @Post()
  @ApiOperation({
    summary: 'Crear producto con receta',
    description:
      'Crea un nuevo producto con su receta (escandallo) de insumos.',
  })
  @ApiResponse({ status: 201, description: 'Producto creado exitosamente' })
  @Roles(Role.ADMIN)
  crear(@Body() body: CreateProductoDto) {
    return this.productosService.crearProductoConReceta(body);
  }

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Listar productos',
    description:
      'Obtiene todos los productos con su receta. Use incluirInactivos=true para ver todos.',
  })
  obtenerTodos(@Query('incluirInactivos') incluirInactivos?: string) {
    return this.productosService.obtenerMenu(incluirInactivos === 'true');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener producto por ID' })
  findOne(@Param('id') id: string) {
    return this.productosService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Actualizar producto',
    description: 'Actualiza datos del producto y/o su receta.',
  })
  @Roles(Role.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateProductoDto) {
    return this.productosService.update(id, dto);
  }

  @Patch(':id/activo')
  @ApiOperation({ summary: 'Cambiar estado activo del producto' })
  @Roles(Role.ADMIN)
  setActivo(@Param('id') id: string, @Body() body: ToggleActivoDto) {
    return this.productosService.setActivo(id, body.activo);
  }

  @Patch(':id/baja')
  @ApiOperation({ summary: 'Dar de baja un producto (activo=false)' })
  @Roles(Role.ADMIN)
  baja(@Param('id') id: string) {
    return this.productosService.setActivo(id, false);
  }

  @Patch(':id/alta')
  @ApiOperation({ summary: 'Dar de alta un producto (activo=true)' })
  @Roles(Role.ADMIN)
  alta(@Param('id') id: string) {
    return this.productosService.setActivo(id, true);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Eliminar producto',
    description: 'Solo permite eliminar productos sin pedidos asociados.',
  })
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.productosService.remove(id);
  }
}
