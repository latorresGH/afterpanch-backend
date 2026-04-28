import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BarriosService } from './barrios.service';
import { CreateBarrioDto, UpdateBarrioDto } from './dto/barrio.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { Public } from '../auth/public.decorator';

@ApiTags('Barrios')
@Controller('barrios')
export class BarriosController {
  constructor(private readonly service: BarriosService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear barrio' })
  create(@Body() dto: CreateBarrioDto) {
    return this.service.create(dto);
  }

  @Get()
  @Public()
  @ApiOperation({ summary: 'Listar barrios' })
  findAll(@Query('activo') activo?: string) {
    const filtroActivo = activo === 'true' ? true : activo === 'false' ? false : undefined;
    return this.service.findAll(filtroActivo);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Obtener barrio por ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar barrio' })
  update(@Param('id') id: string, @Body() dto: UpdateBarrioDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar barrio' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
