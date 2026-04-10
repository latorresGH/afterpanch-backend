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
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ProveedoresService } from './proveedores.service';
import { CreateProveedorDto } from './dto/create-proveedore.dto';
import { UpdateProveedorDto } from './dto/update-proveedore.dto';
import { ToggleActivoDto } from './dto/toggle-activo.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Proveedores')
@ApiBearerAuth()
@Controller('proveedores')
@UseGuards(JwtAuthGuard)
export class ProveedoresController {
  constructor(private readonly proveedoresService: ProveedoresService) {}

  @Post()
  @Roles(Role.ADMIN)
  crear(@Body() dto: CreateProveedorDto) {
    return this.proveedoresService.crear(dto);
  }

  @Get()
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  listar(@Query('incluirInactivos') incluirInactivos?: string) {
    return this.proveedoresService.listar(incluirInactivos === 'true');
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  findOne(@Param('id') id: string) {
    return this.proveedoresService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateProveedorDto) {
    return this.proveedoresService.update(id, dto);
  }

  @Patch(':id/activo')
  @Roles(Role.ADMIN)
  setActivo(@Param('id') id: string, @Body() dto: ToggleActivoDto) {
    return this.proveedoresService.setActivo(id, dto.activo);
  }

  @Patch(':id/baja')
  @Roles(Role.ADMIN)
  baja(@Param('id') id: string) {
    return this.proveedoresService.setActivo(id, false);
  }

  @Patch(':id/alta')
  @Roles(Role.ADMIN)
  alta(@Param('id') id: string) {
    return this.proveedoresService.setActivo(id, true);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.proveedoresService.remove(id);
  }
}
