import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { FeaturesModule } from './features/features.module';
import { PushModule } from './push/push.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule, FeaturesModule, PushModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
