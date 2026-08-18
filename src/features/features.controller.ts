import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthGuard } from './auth.guard';
import { FeaturesService } from './features.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { ProfileDto } from './dto/profile.dto';
import { DiscoverQueryDto } from './dto/discover-query.dto';
import {
  AdminConfigDto,
  AvatarDto,
  BlockUserDto,
  ChangePasswordDto,
  CreateConversationDto,
  DeleteMeDto,
  MessagesQueryDto,
  QuestionnaireDto,
  ReportDto,
  ResolveReportDto,
  SendMessageDto,
  SetConfigKeyDto,
  SuspendDto,
  SwipeDto,
  VerificationDto,
  VerifyUserDto,
} from './dto/feature.dto';

export type AuthReq = { user: { id: string; role: Role } };

@ApiTags('app')
@ApiBearerAuth()
@Controller('api')
@UseGuards(AuthGuard)
export class FeaturesController {
  constructor(private f: FeaturesService) {}

  // ---------------------------------------------------------------- account

  @Get('me')
  @ApiOperation({ summary: 'The signed-in user, their profile and answers' })
  me(@Req() r: AuthReq) {
    return this.f.me(r.user.id);
  }

  @Patch('me')
  updateMe(@Req() r: AuthReq, @Body() b: UpdateMeDto) {
    return this.f.updateMe(r.user.id, b);
  }

  @Delete('me')
  deleteMe(@Req() r: AuthReq, @Body() b: DeleteMeDto) {
    return this.f.deleteMe(r.user.id, b.password || '');
  }

  @Patch('password')
  @ApiOperation({ summary: 'Change password (current password required)' })
  password(@Req() r: AuthReq, @Body() b: ChangePasswordDto) {
    return this.f.changePassword(r.user.id, b.password, b.currentPassword);
  }

  // ---------------------------------------------------------------- profile

  @Put('profile')
  profile(@Req() r: AuthReq, @Body() b: ProfileDto) {
    return this.f.profile(r.user.id, b);
  }

  @Get('users/profile')
  getProfileAlias(@Req() r: AuthReq) {
    return this.f.me(r.user.id);
  }

  @Put('users/profile')
  updateProfileAlias(@Req() r: AuthReq, @Body() b: ProfileDto) {
    return this.f.profile(r.user.id, b);
  }

  @Post('users/avatar')
  uploadAvatar(@Req() r: AuthReq, @Body() b: AvatarDto) {
    return this.f.uploadAvatar(r.user.id, b.avatar || b.photo || b.file || '');
  }

  @Get('users/search')
  searchUsers(@Req() r: AuthReq, @Query('q') query?: string) {
    return this.f.searchUsers(r.user.id, query);
  }

  @Post('users/block')
  blockUserPost(@Req() r: AuthReq, @Body() b: BlockUserDto) {
    return this.f.block(r.user.id, b.userId);
  }

  @Post('users/unblock')
  unblockUserPost(@Req() r: AuthReq, @Body() b: BlockUserDto) {
    return this.f.unblock(r.user.id, b.userId);
  }

  // ---------------------------------------------------------- questionnaire

  @Get('questionnaire')
  @ApiOperation({ summary: "Question definitions plus this user's answers" })
  getQuestionnaire(@Req() r: AuthReq) {
    return this.f.getQuestionnaire(r.user.id);
  }

  @Put('questionnaire')
  questionnaire(@Req() r: AuthReq, @Body() b: QuestionnaireDto) {
    return this.f.questionnaire(r.user.id, b.answers, b.completed ?? true);
  }

  @Post('verification')
  verification(@Req() r: AuthReq, @Body() b: VerificationDto) {
    return this.f.verification(r.user.id, b.documentUrl);
  }

  // --------------------------------------------------------------- matching

  @Get('discover')
  @ApiOperation({ summary: 'Ranked, filtered candidates for the swipe deck' })
  discover(@Req() r: AuthReq, @Query() query: DiscoverQueryDto) {
    return this.f.discover(r.user.id, query);
  }

  @Get('users/:userId')
  @ApiOperation({ summary: "Another student's profile, scored against yours" })
  userProfile(
    @Req() r: AuthReq,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.f.userProfile(r.user.id, userId);
  }

  @Post('swipes/:userId')
  swipe(
    @Req() r: AuthReq,
    @Param('userId', ParseUUIDPipe) id: string,
    @Body() b: SwipeDto,
  ) {
    return this.f.swipe(r.user.id, id, b.decision);
  }

  @Get('matches')
  matches(@Req() r: AuthReq) {
    return this.f.matches(r.user.id);
  }

  @Get('likes')
  likes(@Req() r: AuthReq) {
    return this.f.likes(r.user.id);
  }

  @Delete('matches/:id')
  unmatch(@Req() r: AuthReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.f.unmatch(r.user.id, id);
  }

  @Delete('matches/user/:userId')
  unmatchUser(@Req() r: AuthReq, @Param('userId', ParseUUIDPipe) id: string) {
    return this.f.unmatchUser(r.user.id, id);
  }

  // ------------------------------------------------------------------- chat

  @Get('conversations')
  conversations(@Req() r: AuthReq) {
    return this.f.conversations(r.user.id);
  }

  @Post('conversations')
  @ApiOperation({ summary: 'Open (or reopen) the thread for a match' })
  createConversation(@Req() r: AuthReq, @Body() b: CreateConversationDto) {
    return this.f.createConversation(r.user.id, b);
  }

  @Get('conversations/:id/messages')
  messages(
    @Req() r: AuthReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MessagesQueryDto,
  ) {
    return this.f.messages(r.user.id, id, query);
  }

  @Post('conversations/:id/messages')
  send(
    @Req() r: AuthReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: SendMessageDto,
  ) {
    return this.f.send(r.user.id, id, b.text);
  }

  @Patch('conversations/:id/read')
  @ApiOperation({ summary: 'Mark everything the other person sent as read' })
  readConversation(@Req() r: AuthReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.f.markConversationRead(r.user.id, id);
  }

  // ---------------------------------------------------- notifications, safety

  @Get('notifications')
  notifications(@Req() r: AuthReq) {
    return this.f.listNotifications(r.user.id);
  }

  @Patch('notifications/read-all')
  readAll(@Req() r: AuthReq) {
    return this.f.readAllNotifications(r.user.id);
  }

  @Patch('notifications/:id/read')
  read(@Req() r: AuthReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.f.readNotification(r.user.id, id);
  }

  @Post('reports/:userId')
  report(
    @Req() r: AuthReq,
    @Param('userId', ParseUUIDPipe) id: string,
    @Body() b: ReportDto,
  ) {
    return this.f.report(r.user.id, id, b.reason, b.details);
  }

  @Get('blocks')
  getBlocks(@Req() r: AuthReq) {
    return this.f.getBlockedUsers(r.user.id);
  }

  @Post('blocks/:userId')
  block(@Req() r: AuthReq, @Param('userId', ParseUUIDPipe) id: string) {
    return this.f.block(r.user.id, id);
  }

  @Delete('blocks/:userId')
  unblock(@Req() r: AuthReq, @Param('userId', ParseUUIDPipe) id: string) {
    return this.f.unblock(r.user.id, id);
  }

  // ------------------------------------------------------------------ admin

  @Get('admin/dashboard')
  dashboard(@Req() r: AuthReq) {
    this.f.ensureAdmin(r.user);
    return this.f.dashboard();
  }

  @Get('admin/users')
  users(@Req() r: AuthReq) {
    this.f.ensureAdmin(r.user);
    return this.f.adminUsers();
  }

  @Patch('admin/users/:id/suspend')
  suspend(
    @Req() r: AuthReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: SuspendDto,
  ) {
    this.f.ensureAdmin(r.user);
    return this.f.suspend(id, b.suspended);
  }

  @Patch('admin/users/:id/verify')
  verify(
    @Req() r: AuthReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: VerifyUserDto,
  ) {
    this.f.ensureAdmin(r.user);
    return this.f.verify(id, b.status, b.note);
  }

  @Get('admin/reports')
  reports(@Req() r: AuthReq) {
    this.f.ensureAdmin(r.user);
    return this.f.reports();
  }

  @Patch('admin/reports/:id')
  resolveReport(
    @Req() r: AuthReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: ResolveReportDto,
  ) {
    this.f.ensureAdmin(r.user);
    return this.f.resolveReport(id, b.status);
  }

  @Get('admin/config')
  config(@Req() r: AuthReq) {
    this.f.ensureAdmin(r.user);
    return this.f.config();
  }

  @Put('admin/config')
  @ApiOperation({ summary: 'Update allowed email domains and match weights' })
  setConfig(@Req() r: AuthReq, @Body() b: AdminConfigDto) {
    this.f.ensureAdmin(r.user);
    return this.f.setConfig(b);
  }

  @Put('admin/config/:key')
  setConfigKey(
    @Req() r: AuthReq,
    @Param('key') key: string,
    @Body() b: SetConfigKeyDto,
  ) {
    this.f.ensureAdmin(r.user);
    return this.f.setConfigKey(key, b.value);
  }
}
