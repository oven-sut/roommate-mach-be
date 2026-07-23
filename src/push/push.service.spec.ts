import { Test, TestingModule } from '@nestjs/testing';
import { PushService } from './push.service';
import { PrismaService } from '../prisma/prisma.service';

describe('PushService', () => {
  let service: PushService;
  let prisma: PrismaService;

  const mockPrisma = {
    pushToken: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PushService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PushService>(PushService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should register a token via upsert', async () => {
    mockPrisma.pushToken.upsert.mockResolvedValue({ id: '1', userId: 'user1', token: 'token123', device: 'iphone' });
    const res = await service.registerToken('user1', 'token123', 'iphone');
    expect(prisma.pushToken.upsert).toHaveBeenCalledWith({
      where: { token: 'token123' },
      update: { userId: 'user1', device: 'iphone' },
      create: { userId: 'user1', token: 'token123', device: 'iphone' },
    });
    expect(res).toEqual({ id: '1', userId: 'user1', token: 'token123', device: 'iphone' });
  });

  it('should unregister a token via deleteMany', async () => {
    mockPrisma.pushToken.deleteMany.mockResolvedValue({ count: 1 });
    const res = await service.unregisterToken('user1', 'token123');
    expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user1', token: 'token123' },
    });
    expect(res).toEqual({ count: 1 });
  });
});
