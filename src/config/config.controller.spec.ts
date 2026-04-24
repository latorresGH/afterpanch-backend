import { Test, TestingModule } from '@nestjs/testing';
import { NegocioConfigController } from './config.controller';
import { NegocioConfigService } from './config.service';
import { PrismaService } from '../prisma/prisma.service';

describe('NegocioConfigController', () => {
  let controller: NegocioConfigController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NegocioConfigController],
      providers: [
        NegocioConfigService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    controller = module.get<NegocioConfigController>(NegocioConfigController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
