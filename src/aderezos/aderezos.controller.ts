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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Aderezos/Salsas')
@ApiBearerAuth()
@Controller('aderezos')
@UseGuards(JwtAuthGuard)
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

  @Get()
  @Roles(Role.ADMIN, Role.TRABAJADOR)
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

  @Get(':id')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  @ApiOperation({ summary: 'Obtener aderezo por ID' })
  findOne(@Param('id') id: string) {
    return this.aderezosService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Actualizar aderezo' })
  update(
    @Param('id') id: string,
    @Body() dto: { nombre?: string; stockActual?: number; activo?: boolean },
  ) {
    return this.aderezosService.update(id, dto);
  }

  @Patch(':id/activo')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Cambiar estado activo del aderezo' })
  setActivo(@Param('id') id: string, @Body() dto: { activo: boolean }) {
    return this.aderezosService.setActivo(id, dto.activo);
  }

  @Patch(':id/sumar')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Sumar stock al aderezo' })
  sumarStock(@Param('id') id: string, @Body() dto: { cantidad: number }) {
    return this.aderezosService.sumarStock(id, dto.cantidad);
  }

  @Patch(':id/descontar')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Descontar stock del aderezo' })
  descontarStock(@Param('id') id: string, @Body() dto: { cantidad: number }) {
    return this.aderezosService.descontarStock(id, dto.cantidad);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Eliminar aderezo' })
  remove(@Param('id') id: string) {
    return this.aderezosService.remove(id);
  }
}
