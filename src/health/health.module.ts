import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({
  // PrismaModule and StorageModule are both global.
  controllers: [HealthController],
})
export class HealthModule {}
