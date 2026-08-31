import {
  Controller,
  Post,
  Body,
  Get,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { ProductosService } from './productos.service';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { ToggleActivoDto } from './dto/toggle-activo.dto';
import { CreateProductoDto } from './dto/create-producto.dto';
import { StatsProductoQueryDto } from './dto/stats-producto-query.dto';
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

  /**
   * Menu publico. Es el unico endpoint de productos sin login, y por eso
   * devuelve una vista recortada: id, nombre, precio, imagen, descripcion,
   * categoria y disponibilidad. Nada de receta, stock de insumos, codigo
   * interno ni productos pausados.
   *
   * Antes devolvia el producto entero con `include: { receta: { insumo } }`:
   * cualquiera sin login se bajaba el escandallo completo y el stock real de
   * cada insumo. La vista completa vive ahora en GET /productos/completo
   * (personal) y GET /admin/productos (ADMIN).
   */
  @Get()
  @Public()
  @ApiOperation({
    summary: 'Menu publico',
    description:
      'Productos activos con los campos publicos y su disponibilidad ya ' +
      'calculada. No incluye receta, stock ni codigos internos.',
  })
  @ApiQuery({
    name: 'incluirInactivos',
    required: false,
    deprecated: true,
    description:
      'IGNORADO. El menu publico nunca devuelve pausados. Se sigue aceptando ' +
      'para no romper clientes viejos que lo mandan; para ver pausados esta ' +
      'GET /productos/completo.',
  })
  obtenerTodos(@Query('incluirInactivos') _incluirInactivos?: string) {
    return this.productosService.obtenerMenuPublico();
  }

  /**
   * La vista que antes servia GET /productos: producto completo + categoria +
   * receta con el insumo entero. Queda para el personal (POS y los modales de
   * gestion), que la necesita para el control de stock en pantalla.
   */
  @Get('completo')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  @ApiOperation({
    summary: 'Listado completo para el personal',
    description:
      'Productos con receta, insumos y stock. Use incluirInactivos=true para ' +
      'incluir los pausados. Para la pantalla del panel usar GET /admin/productos, ' +
      'que ademas trae ventas, stats y paginacion.',
  })
  @ApiQuery({ name: 'incluirInactivos', required: false, type: Boolean })
  obtenerCompleto(@Query('incluirInactivos') incluirInactivos?: string) {
    return this.productosService.obtenerMenuCompleto(
      incluirInactivos === 'true',
    );
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  @ApiOperation({
    summary: 'Obtener producto por ID',
    description: 'Incluye receta e insumos: no es informacion publica.',
  })
  findOne(@Param('id') id: string) {
    return this.productosService.findOne(id);
  }

  @Get(':id/stats')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Estadísticas de ventas de un producto',
    description:
      'Devuelve cantidad vendida y total recaudado para un producto en un rango de fechas. Solo incluye pedidos ENTREGADO.',
  })
  getStats(@Param('id') id: string, @Query() query: StatsProductoQueryDto) {
    return this.productosService.getStats(
      id,
      query.fechaInicio,
      query.fechaFin,
    );
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

  /** Canonico para activar/pausar. `baja` y `alta` hacen esto mismo. */
  @Patch(':id/activo')
  @ApiOperation({
    summary: 'Cambiar estado activo del producto',
    description:
      'Endpoint canonico para pausar/activar. Reemplaza a :id/baja y :id/alta.',
  })
  @Roles(Role.ADMIN)
  setActivo(@Param('id') id: string, @Body() body: ToggleActivoDto) {
    return this.productosService.setActivo(id, body.activo);
  }

  /**
   * DEPRECADO — usar PATCH /productos/:id/activo con { activo: false }.
   * Se mantiene porque el front actual (useProductos.toggleActivo) todavia
   * pega aca; se borra cuando esa llamada migre.
   */
  @Patch(':id/baja')
  @ApiOperation({
    summary: 'Dar de baja un producto (activo=false)',
    deprecated: true,
    description:
      'DEPRECADO: usar PATCH /productos/:id/activo { activo: false }.',
  })
  @Roles(Role.ADMIN)
  baja(@Param('id') id: string) {
    return this.productosService.setActivo(id, false);
  }

  /**
   * DEPRECADO — usar PATCH /productos/:id/activo con { activo: true }.
   * Misma nota que en :id/baja.
   */
  @Patch(':id/alta')
  @ApiOperation({
    summary: 'Dar de alta un producto (activo=true)',
    deprecated: true,
    description:
      'DEPRECADO: usar PATCH /productos/:id/activo { activo: true }.',
  })
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
