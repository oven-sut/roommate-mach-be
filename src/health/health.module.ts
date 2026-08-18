import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features/features.module';
import { HealthController } from './health.controller';

@Module({
  imports: [FeaturesModule],
  controllers: [HealthController],
})
export class HealthModule {}
