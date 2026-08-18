import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PushService } from './push.service';
import { AuthGuard } from '../features/auth.guard';
import type { AuthReq } from '../features/features.controller';

export class PushTokenDto {
  @IsString()
  @MinLength(8, { message: 'Token is required' })
  @MaxLength(255)
  token: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  device?: string;
}

@ApiTags('push')
@ApiBearerAuth()
@Controller(['push', 'api/push'])
@UseGuards(AuthGuard)
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Post('register')
  @HttpCode(HttpStatus.OK)
  register(@Req() r: AuthReq, @Body() b: PushTokenDto) {
    return this.pushService.registerToken(r.user.id, b.token, b.device);
  }

  @Post('unregister')
  @HttpCode(HttpStatus.OK)
  unregister(@Req() r: AuthReq, @Body() b: PushTokenDto) {
    return this.pushService.unregisterToken(r.user.id, b.token);
  }
}
