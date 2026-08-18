import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('names the service and points at the docs and health check', () => {
      expect(appController.getInfo()).toEqual({
        name: 'Roommate Match API',
        status: 'ok',
        docs: '/api/docs',
        health: '/health',
      });
    });
  });
});
