import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { PushService } from './push.service';
import { AuthGuard } from '../features/auth.guard';
import type { AuthReq } from '../features/features.controller';

@Controller('push')
@UseGuards(AuthGuard)
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Post('register')
  register(@Req() r: AuthReq, @Body() b: { token: string; device?: string }) {
    if (!b.token) {
      throw new Error('Token is required');
    }
    return this.pushService.registerToken(r.user.id, b.token, b.device);
  }

  @Post('unregister')
  unregister(@Req() r: AuthReq, @Body() b: { token: string }) {
    if (!b.token) {
      throw new Error('Token is required');
    }
    return this.pushService.unregisterToken(r.user.id, b.token);
  }
}
