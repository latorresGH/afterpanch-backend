import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
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
import { AderezosService } from './aderezos.service';
import { CreateAderezoDto } from './dto/create-aderezo.dto';
import { SetPrecioCategoriaDto } from './dto/set-precio-categoria.dto';
import { SetConsumoCategoriaDto } from './dto/set-consumo-categoria.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { ToggleActivoAderezoDto } from './dto/toggle-activo.dto';
import { StockMovAderezoDto } from './dto/stock-mov.dto';
import { MovimientosQueryDto } from '../insumos/dto/movimientos-query.dto';
import { UpdateAderezoLegacyDto } from './dto/admin-aderezo.dto';

@ApiTags('Aderezos/Salsas')
@ApiBearerAuth()
@Controller('aderezos')
export class AderezosController {
  constructor(private readonly aderezosService: AderezosService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Crear aderezo/salsa',
    description:
      'Crea un nuevo aderezo que puede tener precios diferentes por categoría de producto.',
  })
  create(@Body() createAderezoDto: CreateAderezoDto) {
    return this.aderezosService.create(createAderezoDto);
  }

  @Post('precio-categoria')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Asignar precio de aderezo por categoría',
    description:
      'Define el precio de un aderezo para una categoría específica. Ej: Quede puede costar 300 en panchos y 500 en hamburguesas.',
  })
  setPrecioCategoria(@Body() dto: SetPrecioCategoriaDto) {
    return this.aderezosService.setPrecioCategoria(dto);
  }

  @Post('consumo-categoria')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Asignar consumo de aderezo por categoría',
    description:
      'Define cuánto se consume de un aderezo para una categoría específica. Ej: Mayonesa 40g en hamburguesas, 30g en panchos.',
  })
  setConsumoCategoria(@Body() dto: SetConsumoCategoriaDto) {
    return this.aderezosService.setConsumoCategoria(dto);
  }

  @Get(':id/consumo/:categoriaId')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  @ApiOperation({ summary: 'Obtener consumo de aderezo por categoría' })
  getConsumoPorCategoria(
    @Param('id') aderezoId: string,
    @Param('categoriaId') categoriaId: string,
  ) {
    return this.aderezosService.getConsumoPorCategoria(aderezoId, categoriaId);
  }

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Listar aderezos',
    description: 'Obtiene todos los aderezos con sus precios por categoría.',
  })
  findAll(
    @Query('incluirInactivos') incluirInactivos?: string,
    @Query('soloDisponibles') soloDisponibles?: string,
  ) {
    return this.aderezosService.findAll({
      incluirInactivos: incluirInactivos === 'true',
      soloDisponibles: soloDisponibles === 'true',
    });
  }

  @Get('por-categoria-producto/:categoriaId')
  @Public()
  @ApiOperation({
    summary: 'Obtener aderezos disponibles para una categoría de producto',
    description:
      'Retorna aderezos que aplican a una categoría específica o que son globales (sin categoría asignada).',
  })
  findByCategoriaProducto(@Param('categoriaId') categoriaId: string) {
    return this.aderezosService.findByCategoriaProducto(categoriaId);
  }

  @Get('por-categoria-con-stock/:categoriaId')
  @Public()
  @ApiOperation({
    summary:
      'Obtener aderezos disponibles con stock suficiente para una categoría',
    description:
      'Retorna aderezos filtrando por categoría y verificando que el stock sea suficiente según el consumo configurado para esa categoría.',
  })
  findByCategoriaProductoConStock(@Param('categoriaId') categoriaId: string) {
    return this.aderezosService.findByCategoriaProductoConStock(categoriaId);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  @ApiOperation({ summary: 'Obtener aderezo por ID' })
  findOne(@Param('id') id: string) {
    return this.aderezosService.findOne(id);
  }

  /**
   * ⚠️ LOS CUATRO PATCH DE ABAJO RECIBIAN EL BODY COMO TIPO INLINE
   * (`@Body() dto: { activo: boolean }` y similares). TypeScript borra esos
   * tipos al compilar, asi que el ValidationPipe global no tenia metadata que
   * mirar y NO VALIDABA NADA: un body vacio llegaba al service como
   * `undefined`. Ahora cada uno tiene su DTO de verdad, igual que se hizo en
   * Insumos.
   */
  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Actualizar aderezo',
    description:
      'Reusa las validaciones del panel: unidad contra la lista blanca, ' +
      'stockMinimo > 0 y stockActual >= 0. `consumos` NO se acepta por aca ' +
      '(este endpoint no sabe guardarlo): para el consumo por categoria esta ' +
      'POST /aderezos/consumo-categoria o, mejor, PATCH /admin/aderezos/:id.',
  })
  update(@Param('id') id: string, @Body() dto: UpdateAderezoLegacyDto) {
    return this.aderezosService.update(id, dto);
  }

  @Patch(':id/activo')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Cambiar estado activo del aderezo' })
  setActivo(@Param('id') id: string, @Body() dto: ToggleActivoAderezoDto) {
    return this.aderezosService.setActivo(id, dto.activo);
  }

  /**
   * Ajuste rapido de stock. ESTOS son los que tiene que usar el panel nuevo,
   * no el PATCH de arriba con `stockActual` absoluto: hacen increment /
   * decrement ATOMICO en la base y escriben el movimiento, asi que dos ajustes
   * simultaneos (o un ajuste mientras entra un pedido) no se pisan.
   */
  @Patch(':id/sumar')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Sumar stock al aderezo (increment atomico)',
    description: 'Suma sobre el valor actual en la base y deja el movimiento.',
  })
  sumarStock(@Param('id') id: string, @Body() dto: StockMovAderezoDto) {
    return this.aderezosService.sumarStock(id, dto.cantidad, dto.motivo);
  }

  @Patch(':id/descontar')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Descontar stock del aderezo (decrement atomico)',
    description:
      'Descuenta sobre el valor actual en la base y deja el movimiento. ' +
      'Rechaza con 400 si no alcanza el stock.',
  })
  descontarStock(@Param('id') id: string, @Body() dto: StockMovAderezoDto) {
    return this.aderezosService.descontarStock(id, dto.cantidad, dto.motivo);
  }

  @Get(':id/movimientos')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  @ApiOperation({
    summary: 'Historial de movimientos de stock',
    description: '`limit` clampeado a 1..200 (50 por defecto).',
  })
  obtenerMovimientos(
    @Param('id') id: string,
    @Query() query: MovimientosQueryDto,
  ) {
    return this.aderezosService.obtenerMovimientos(id, query.limit);
  }

  @Get('movimientos/recientes')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  @ApiOperation({
    summary: 'Movimientos recientes de stock',
    description: '`limit` clampeado a 1..200 (20 por defecto).',
  })
  obtenerMovimientosRecientes(@Query() query: MovimientosQueryDto) {
    return this.aderezosService.obtenerMovimientosRecientes(query.limit);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Eliminar aderezo' })
  remove(@Param('id') id: string) {
    return this.aderezosService.remove(id);
  }
}
