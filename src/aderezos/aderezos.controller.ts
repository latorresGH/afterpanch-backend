// src/aderezos/aderezos.controller.ts
import { Controller, Get, Post, Body, Param, Delete } from '@nestjs/common';
import { AderezosService } from './aderezos.service';
import { CreateAderezoDto } from './dto/create-aderezo.dto';

@Controller('aderezos')
export class AderezosController {
  constructor(private readonly aderezosService: AderezosService) {}

  @Post()
  create(@Body() createAderezoDto: CreateAderezoDto) {
    return this.aderezosService.create(createAderezoDto);
  }

  @Get()
  findAll() {
    return this.aderezosService.findAll();
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.aderezosService.remove(id);
  }
}