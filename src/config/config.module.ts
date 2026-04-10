import { Module } from '@nestjs/common';
import { NegocioConfigService } from './config.service';
import { NegocioConfigController } from './config.controller';

@Module({
  providers: [NegocioConfigService],
  controllers: [NegocioConfigController],
  exports: [NegocioConfigService],
})
export class NegocioConfigModule {}
