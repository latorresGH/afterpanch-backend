import { Test, TestingModule } from '@nestjs/testing';
import { ProductosService } from './productos.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ProductosService', () => {
  let service: ProductosService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductosService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    service = module.get<ProductosService>(ProductosService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
