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
import { ExtrasService } from './extras.service';
import { CreateExtraDto } from './dto/create-extra.dto';
import { UpdateExtraDto } from './dto/update-extra.dto';
import { SetExtraPrecioCategoriaDto } from './dto/set-precio-categoria.dto';
import { ToggleActivoDto } from './dto/toggle-activo.dto';
import { StockMovDto } from './dto/stock-mov.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { Public } from '../auth/public.decorator';

@ApiTags('Extras')
@ApiBearerAuth()
@Controller('extras')
export class ExtrasController {
  constructor(private extras: ExtrasService) {}

  @Post()
  @ApiOperation({
    summary: 'Crear extra',
    description: 'Crea un nuevo extra (adicional) como aderezos, bebidas, etc.',
  })
  @Roles(Role.ADMIN)
  create(@Body() dto: CreateExtraDto) {
    return this.extras.create(dto);
  }

  @Post('precio-categoria')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Asignar precio de extra por categoría',
    description:
      'Define el precio de un extra para una categoría específica. Ej: Quede puede costar 300 en panchos y 500 en hamburguesas.',
  })
  setPrecioCategoria(@Body() dto: SetExtraPrecioCategoriaDto) {
    return this.extras.setPrecioCategoria(dto);
  }

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Listar extras',
    description:
      'Lista extras con filtros opcionales por categoría y disponibilidad.',
  })
  findAll(
    @Query('incluirInactivos') incluirInactivos?: string,
    @Query('soloDisponibles') soloDisponibles?: string,
    @Query('categoria') categoria?: string,
  ) {
    return this.extras.findAll({
      incluirInactivos: incluirInactivos === 'true',
      soloDisponibles: soloDisponibles === 'true',
      categoria,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener extra por ID' })
  findOne(@Param('id') id: string) {
    return this.extras.findOne(id);
  }

  @Get(':extraId/precio/:categoriaId')
  @ApiOperation({
    summary: 'Obtener precio de extra para una categoría específica',
  })
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  getPrecioPorCategoria(
    @Param('extraId') extraId: string,
    @Param('categoriaId') categoriaId: string,
  ) {
    return this.extras.getPrecioPorCategoria(extraId, categoriaId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar extra' })
  @Roles(Role.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateExtraDto) {
    return this.extras.update(id, dto);
  }

  @Patch(':id/activo')
  @ApiOperation({ summary: 'Cambiar estado activo del extra' })
  @Roles(Role.ADMIN)
  setActivo(@Param('id') id: string, @Body() dto: ToggleActivoDto) {
    return this.extras.setActivo(id, dto.activo);
  }

  @Patch(':id/sumar')
  @ApiOperation({
    summary: 'Sumar stock al extra',
    description: 'Incrementa el stock actual del extra.',
  })
  @Roles(Role.ADMIN)
  sumar(@Param('id') id: string, @Body() dto: StockMovDto) {
    return this.extras.sumarStock(id, dto.cantidad);
  }

  @Patch(':id/descontar')
  @ApiOperation({
    summary: 'Descontar stock del extra',
    description: 'Decrementa el stock. Valida que no quede negativo.',
  })
  @Roles(Role.ADMIN)
  descontar(@Param('id') id: string, @Body() dto: StockMovDto) {
    return this.extras.descontarStock(id, dto.cantidad);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar extra' })
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.extras.remove(id);
  }
}
