import { Test, TestingModule } from '@nestjs/testing';
import { NegocioConfigService } from './config.service';
import { PrismaService } from '../prisma/prisma.service';

describe('NegocioConfigService', () => {
  let service: NegocioConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NegocioConfigService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    service = module.get<NegocioConfigService>(NegocioConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
