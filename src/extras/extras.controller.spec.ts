import { Test, TestingModule } from '@nestjs/testing';
import { ExtrasController } from './extras.controller';

describe('ExtrasController', () => {
  let controller: ExtrasController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExtrasController],
    }).compile();

    controller = module.get<ExtrasController>(ExtrasController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
