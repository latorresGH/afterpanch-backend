import { Test, TestingModule } from '@nestjs/testing';
import { AderezosService } from './aderezos.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AderezosService', () => {
  let service: AderezosService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AderezosService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    service = module.get<AderezosService>(AderezosService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
