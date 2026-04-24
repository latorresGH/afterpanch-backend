import { Test, TestingModule } from '@nestjs/testing';
import { ExtrasController } from './extras.controller';
import { ExtrasService } from './extras.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ExtrasController', () => {
  let controller: ExtrasController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExtrasController],
      providers: [
        ExtrasService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    controller = module.get<ExtrasController>(ExtrasController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
