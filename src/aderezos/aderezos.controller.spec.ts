import { Test, TestingModule } from '@nestjs/testing';
import { AderezosController } from './aderezos.controller';

describe('AderezosController', () => {
  let controller: AderezosController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AderezosController],
    }).compile();

    controller = module.get<AderezosController>(AderezosController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
