import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from './auth.guard';
import { FeaturesController } from './features.controller';
import { FeaturesService } from './features.service';

@Module({
  imports: [AuthModule],
  controllers: [FeaturesController],
  providers: [FeaturesService, AuthGuard],
  exports: [FeaturesService],
})
export class FeaturesModule {}
