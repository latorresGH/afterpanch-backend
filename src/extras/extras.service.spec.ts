import { Test, TestingModule } from '@nestjs/testing';
import { ExtrasService } from './extras.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ExtrasService', () => {
  let service: ExtrasService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExtrasService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    service = module.get<ExtrasService>(ExtrasService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
