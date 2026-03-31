import { Module } from '@nestjs/common';
import { OfertasController } from './ofertas.controller';
import { OfertasService } from './ofertas.service';
import { OfertasCalculatorService } from './ofertas-calculator.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [OfertasController],
  providers: [OfertasService, OfertasCalculatorService],
  exports: [OfertasService, OfertasCalculatorService],
})
export class OfertasModule {}
