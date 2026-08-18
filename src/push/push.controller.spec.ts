import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PushController, PushTokenDto } from './push.controller';
import { PushService } from './push.service';
import { AuthGuard } from '../features/auth.guard';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

describe('PushController', () => {
  let controller: PushController;
  let pushService: PushService;

  const mockPushService = {
    registerToken: jest.fn(),
    unregisterToken: jest.fn(),
  };

  const req = { user: { id: 'user1', role: Role.USER } };

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

  it('registers a token for the signed-in user', async () => {
    mockPushService.registerToken.mockResolvedValue(true);

    const result = await controller.register(req, {
      token: 'ExponentPushToken[abc123]',
      device: 'android',
    });

    expect(pushService.registerToken).toHaveBeenCalledWith(
      'user1',
      'ExponentPushToken[abc123]',
      'android',
    );
    expect(result).toBe(true);
  });

  it('unregisters a token', async () => {
    mockPushService.unregisterToken.mockResolvedValue(true);

    const result = await controller.unregister(req, {
      token: 'ExponentPushToken[abc123]',
    });

    expect(pushService.unregisterToken).toHaveBeenCalledWith(
      'user1',
      'ExponentPushToken[abc123]',
    );
    expect(result).toBe(true);
  });

  // Validation moved to the DTO, so a missing token is a 400 from the pipe
  // rather than an unhandled Error surfacing as a 500.
  it('rejects a missing token before the handler runs', async () => {
    const errors = await validate(plainToInstance(PushTokenDto, { token: '' }));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('token');
  });

  it('accepts a token without a device', async () => {
    const errors = await validate(
      plainToInstance(PushTokenDto, { token: 'ExponentPushToken[abc123]' }),
    );
    expect(errors).toHaveLength(0);
  });
});
