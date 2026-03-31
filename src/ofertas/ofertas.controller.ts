import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OfertasService } from './ofertas.service';
import { OfertasCalculatorService } from './ofertas-calculator.service';
import { CreateOfertaDto } from './dto/create-oferta.dto';
import { UpdateOfertaDto } from './dto/update-oferta.dto';
import { PreviewOfertaDto } from './dto/preview-oferta.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';

@Controller('ofertas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OfertasController {
  constructor(
    private ofertasService: OfertasService,
    private calculatorService: OfertasCalculatorService,
  ) {}

  @Post()
  @Roles(Role.ADMIN)
  crear(@Body() dto: CreateOfertaDto) {
    return this.ofertasService.crear(dto);
  }

  @Get()
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  listar(@Query('activas') activas?: string) {
    return this.ofertasService.findAll(activas === 'true');
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  findOne(@Param('id') id: string) {
    return this.ofertasService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  actualizar(@Param('id') id: string, @Body() dto: UpdateOfertaDto) {
    return this.ofertasService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  eliminar(@Param('id') id: string) {
    return this.ofertasService.remove(id);
  }

  @Patch(':id/activa')
  @Roles(Role.ADMIN)
  setActiva(@Param('id') id: string, @Body('activa') activa: boolean) {
    return this.ofertasService.setActiva(id, activa);
  }

  @Post('calcular')
  @Roles(Role.ADMIN, Role.TRABAJADOR)
  async previsualizar(@Body() dto: PreviewOfertaDto) {
    return this.calculatorService.calcularTotal(
      dto.lineas.map((l) => ({
        productoId: l.productoId,
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitario || 0,
        extras: l.extras?.map((e) => ({
          extraId: e.extraId,
          cantidad: e.cantidad,
          precio: e.precio || 0,
        })),
      })),
    );
  }
}
