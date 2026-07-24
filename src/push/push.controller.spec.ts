import { Test, TestingModule } from '@nestjs/testing';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { AuthGuard } from '../features/auth.guard';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

describe('PushController', () => {
  let controller: PushController;
  let pushService: PushService;

  const mockPushService = {
    registerToken: jest.fn(),
    unregisterToken: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PushController],
      providers: [
        { provide: PushService, useValue: mockPushService },
        { provide: JwtService, useValue: {} },
        { provide: PrismaService, useValue: {} },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PushController>(PushController);
    pushService = module.get<PushService>(PushService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call registerToken on service', async () => {
    mockPushService.registerToken.mockResolvedValue(true);
    const req = { user: { id: 'user1' } };
    const body = { token: 'token123', device: 'android' };
    const result = await controller.register(req, body);
    expect(pushService.registerToken).toHaveBeenCalledWith(
      'user1',
      'token123',
      'android',
    );
    expect(result).toBe(true);
  });

  it('should call unregisterToken on service', async () => {
    mockPushService.unregisterToken.mockResolvedValue(true);
    const req = { user: { id: 'user1' } };
    const body = { token: 'token123' };
    const result = await controller.unregister(req, body);
    expect(pushService.unregisterToken).toHaveBeenCalledWith(
      'user1',
      'token123',
    );
    expect(result).toBe(true);
  });

  it('should throw an error if token is missing in register', async () => {
    const req = { user: { id: 'user1' } };
    const body = { token: '' };
    expect(() => controller.register(req, body)).toThrow('Token is required');
  });
});
