import { Module } from '@nestjs/common';
import { InsumosService } from './insumos.service';
import { InsumosController } from './insumos.controller';

@Module({
  controllers: [InsumosController],
  providers: [InsumosService],
})
export class InsumosModule {}
