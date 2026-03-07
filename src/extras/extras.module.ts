import { Module } from '@nestjs/common';
import { ExtrasController } from './extras.controller';
import { ExtrasService } from './extras.service';

@Module({
  controllers: [ExtrasController],
  providers: [ExtrasService]
})
export class ExtrasModule {}
