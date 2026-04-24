import { Test, TestingModule } from '@nestjs/testing';
import { AderezosController } from './aderezos.controller';
import { AderezosService } from './aderezos.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AderezosController', () => {
  let controller: AderezosController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AderezosController],
      providers: [
        AderezosService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    controller = module.get<AderezosController>(AderezosController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
