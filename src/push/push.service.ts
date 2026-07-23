import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PushService {
  constructor(private prisma: PrismaService) {}

  async registerToken(userId: string, token: string, device?: string) {
    return this.prisma.pushToken.upsert({
      where: { token },
      update: { userId, device },
      create: { userId, token, device },
    });
  }

  async unregisterToken(userId: string, token: string) {
    return this.prisma.pushToken.deleteMany({
      where: { userId, token },
    });
  }
}
