import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InsumosService } from './insumos.service';
import { UpdateInsumoDto } from './dto/update-insumo.dto';
import { SumarStockDto } from './dto/sumar-stock.dto';
import { ToggleActivoDto } from './dto/toggle-activo.dto';
import { DescontarStockDto } from './dto/descontar-stock.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Insumos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.TRABAJADOR)
@Controller('insumos')
export class InsumosController {
  constructor(private readonly insumosService: InsumosService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Crear insumo',
    description: 'Crea un nuevo insumo para control de stock.',
  })
  crear(
    @Body()
    body: {
      nombre: string;
      stockInicial: number;
      unidad: string;
      proveedorId?: string | null;
    },
  ) {
    return this.insumosService.crear(
      body.nombre,
      body.stockInicial,
      body.unidad,
      body.proveedorId ?? null,
    );
  }

  @Get()
  @ApiOperation({
    summary: 'Listar insumos',
    description: 'Obtiene todos los insumos con su stock actual.',
  })
  obtenerTodo(@Query('incluirInactivos') incluirInactivos?: string) {
    return this.insumosService.obtenerTodo(incluirInactivos === 'true');
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Actualizar insumo' })
  actualizar(@Param('id') id: string, @Body() dto: UpdateInsumoDto) {
    return this.insumosService.actualizar(id, dto);
  }

  @Patch(':id/sumar')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  @ApiOperation({
    summary: 'Sumar stock al insumo',
    description: 'Incrementa el stock del insumo.',
  })
  sumarStock(@Param('id') id: string, @Body() dto: SumarStockDto) {
    return this.insumosService.sumarStock(id, dto.cantidad);
  }

  @Patch(':id/restar')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Descontar stock',
    description: 'Decrementa stock validando que no quede negativo.',
  })
  descontarStock(@Param('id') id: string, @Body() dto: DescontarStockDto) {
    return this.insumosService.descontarStock(id, dto.cantidad);
  }

  @Patch(':id/activo')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Cambiar estado activo del insumo' })
  setActivo(@Param('id') id: string, @Body() dto: ToggleActivoDto) {
    return this.insumosService.setActivo(id, dto.activo);
  }

  @Patch(':id/baja')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Dar de baja insumo (activo=false)' })
  baja(@Param('id') id: string) {
    return this.insumosService.setActivo(id, false);
  }

  @Patch(':id/alta')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Dar de alta insumo (activo=true)' })
  alta(@Param('id') id: string) {
    return this.insumosService.setActivo(id, true);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Eliminar insumo',
    description: 'Solo si no está en ninguna receta.',
  })
  borrar(@Param('id') id: string) {
    return this.insumosService.borrar(id);
  }
}
