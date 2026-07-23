import { Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../features/auth.guard';

@Module({
  imports: [AuthModule],
  controllers: [PushController],
  providers: [PushService, PrismaService, AuthGuard],
  exports: [PushService],
})
export class PushModule {}
