import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role, SwipeDecision } from '@prisma/client';
import { AuthGuard } from './auth.guard';
import { FeaturesService } from './features.service';

export type AuthReq = { user: { id: string; role: Role } };

@Controller('api')
@UseGuards(AuthGuard)
export class FeaturesController {
  constructor(private f: FeaturesService) {}
  @Get('me') me(@Req() r: AuthReq) {
    return this.f.me(r.user.id);
  }
  @Patch('me') updateMe(@Req() r: AuthReq, @Body() b: Record<string, unknown>) {
    return this.f.updateMe(r.user.id, b);
  }
  @Put('profile') profile(
    @Req() r: AuthReq,
    @Body() b: Record<string, unknown>,
  ) {
    return this.f.profile(r.user.id, b);
  }
  @Get('questionnaire') getQuestionnaire() {
    return this.f.getQuestionnaire();
  }
  @Put('questionnaire') questionnaire(@Req() r: unknown, @Body() b: unknown) {
    const req = r as { user: { id: string } };
    const body = b as { answers: Record<string, unknown>; completed: boolean };
    return this.f.questionnaire(req.user.id, body.answers, body.completed);
  }
  @Post('verification') verification(
    @Req() r: AuthReq,
    @Body() b: { documentUrl: string },
  ) {
    return this.f.verification(r.user.id, b.documentUrl);
  }
  @Get('discover') discover(@Req() r: AuthReq, @Query('page') page?: string) {
    return this.f.discover(r.user.id, page);
  }
  @Post('swipes/:userId') swipe(
    @Req() r: AuthReq,
    @Param('userId') id: string,
    @Body() b: { decision: SwipeDecision },
  ) {
    return this.f.swipe(r.user.id, id, b.decision);
  }
  @Get('matches') matches(@Req() r: AuthReq) {
    return this.f.matches(r.user.id);
  }
  @Get('likes') likes(@Req() r: AuthReq) {
    return this.f.likes(r.user.id);
  }
  @Delete('matches/:id') unmatch(@Req() r: AuthReq, @Param('id') id: string) {
    return this.f.unmatch(r.user.id, id);
  }
  @Delete('matches/user/:userId') unmatchUser(
    @Req() r: AuthReq,
    @Param('userId') id: string,
  ) {
    return this.f.unmatchUser(r.user.id, id);
  }
  @Get('conversations') conversations(@Req() r: AuthReq) {
    return this.f.conversations(r.user.id);
  }
  @Get('conversations/:id/messages') messages(
    @Req() r: AuthReq,
    @Param('id') id: string,
  ) {
    return this.f.messages(r.user.id, id);
  }
  @Post('conversations/:id/messages') send(
    @Req() r: AuthReq,
    @Param('id') id: string,
    @Body() b: { text: string },
  ) {
    return this.f.send(r.user.id, id, b.text);
  }
  @Get('notifications') notifications(@Req() r: AuthReq) {
    return this.f.notifications(r.user.id);
  }
  @Patch('notifications/:id/read') read(
    @Req() r: AuthReq,
    @Param('id') id: string,
  ) {
    return this.f.readNotification(r.user.id, id);
  }
  @Post('reports/:userId') report(
    @Req() r: AuthReq,
    @Param('userId') id: string,
    @Body() b: { reason: string; details?: string },
  ) {
    return this.f.report(r.user.id, id, b.reason, b.details);
  }
  @Post('blocks/:userId') block(
    @Req() r: AuthReq,
    @Param('userId') id: string,
  ) {
    return this.f.block(r.user.id, id);
  }
  @Delete('blocks/:userId') unblock(
    @Req() r: AuthReq,
    @Param('userId') id: string,
  ) {
    return this.f.unblock(r.user.id, id);
  }
  @Patch('password') password(
    @Req() r: AuthReq,
    @Body() b: { password: string },
  ) {
    return this.f.changePassword(r.user.id, b.password);
  }
  @Get('admin/dashboard') dashboard(@Req() r: AuthReq) {
    this.f.ensureAdmin(r.user);
    return this.f.dashboard();
  }
  @Get('admin/users') users(@Req() r: AuthReq) {
    this.f.ensureAdmin(r.user);
    return this.f.adminUsers();
  }
  @Patch('admin/users/:id/suspend') suspend(
    @Req() r: AuthReq,
    @Param('id') id: string,
    @Body() b: { suspended: boolean },
  ) {
    this.f.ensureAdmin(r.user);
    return this.f.suspend(id, b.suspended);
  }
  @Patch('admin/users/:id/verify') verify(
    @Req() r: AuthReq,
    @Param('id') id: string,
    @Body() b: { status: 'VERIFIED' | 'REJECTED' },
  ) {
    this.f.ensureAdmin(r.user);
    return this.f.verify(id, b.status);
  }
  @Get('admin/reports') reports(@Req() r: AuthReq) {
    this.f.ensureAdmin(r.user);
    return this.f.reports();
  }
  @Get('admin/config') config(@Req() r: AuthReq) {
    this.f.ensureAdmin(r.user);
    return this.f.config();
  }
  @Put('admin/config/:key') setConfig(
    @Req() r: AuthReq,
    @Param('key') key: string,
    @Body() b: { value: unknown },
  ) {
    this.f.ensureAdmin(r.user);
    return this.f.setConfig(key, b.value);
  }
}
