import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { PushService } from './push.service';
import { AuthGuard } from '../features/auth.guard';

@Controller('push')
@UseGuards(AuthGuard)
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Post('register')
  register(@Req() r: any, @Body() b: { token: string; device?: string }) {
    if (!b.token) {
      throw new Error('Token is required');
    }
    return this.pushService.registerToken(r.user.id, b.token, b.device);
  }

  @Post('unregister')
  unregister(@Req() r: any, @Body() b: { token: string }) {
    if (!b.token) {
      throw new Error('Token is required');
    }
    return this.pushService.unregisterToken(r.user.id, b.token);
  }
}
