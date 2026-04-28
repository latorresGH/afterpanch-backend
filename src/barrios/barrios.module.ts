import { Module } from '@nestjs/common';
import { BarriosService } from './barrios.service';
import { BarriosController } from './barrios.controller';

@Module({
  controllers: [BarriosController],
  providers: [BarriosService],
  exports: [BarriosService],
})
export class BarriosModule {}
