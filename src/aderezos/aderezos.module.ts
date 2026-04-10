import { Module } from '@nestjs/common';
import { AderezosController } from './aderezos.controller';
import { AderezosService } from './aderezos.service';

@Module({
  controllers: [AderezosController],
  providers: [AderezosService],
})
export class AderezosModule {}
