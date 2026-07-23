import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { SwipeDecision } from '@prisma/client';
import { AuthGuard } from './auth.guard';
import { FeaturesService } from './features.service';

@Controller('api') @UseGuards(AuthGuard)
export class FeaturesController {
 constructor(private f:FeaturesService){}
 @Get('me') me(@Req() r:any){return this.f.me(r.user.id)}
 @Patch('me') updateMe(@Req()r:any,@Body()b:any){return this.f.updateMe(r.user.id,b)}
 @Put('profile') profile(@Req()r:any,@Body()b:any){return this.f.profile(r.user.id,b)}
 @Put('questionnaire') questionnaire(@Req()r:any,@Body()b:any){return this.f.questionnaire(r.user.id,b.answers,b.completed)}
 @Post('verification') verification(@Req()r:any,@Body()b:any){return this.f.verification(r.user.id,b.documentUrl)}
 @Get('discover') discover(@Req()r:any){return this.f.discover(r.user.id)}
 @Post('swipes/:userId') swipe(@Req()r:any,@Param('userId')id:string,@Body()b:{decision:SwipeDecision}){return this.f.swipe(r.user.id,id,b.decision)}
 @Get('matches') matches(@Req()r:any){return this.f.matches(r.user.id)}
 @Get('likes') likes(@Req()r:any){return this.f.likes(r.user.id)}
 @Delete('matches/:id') unmatch(@Req()r:any,@Param('id')id:string){return this.f.unmatch(r.user.id,id)}
 @Delete('matches/user/:userId') unmatchUser(@Req()r:any,@Param('userId')id:string){return this.f.unmatchUser(r.user.id,id)}
 @Get('conversations') conversations(@Req()r:any){return this.f.conversations(r.user.id)}
 @Get('conversations/:id/messages') messages(@Req()r:any,@Param('id')id:string){return this.f.messages(r.user.id,id)}
 @Post('conversations/:id/messages') send(@Req()r:any,@Param('id')id:string,@Body()b:{text:string}){return this.f.send(r.user.id,id,b.text)}
 @Get('notifications') notifications(@Req()r:any){return this.f.notifications(r.user.id)}
 @Patch('notifications/:id/read') read(@Req()r:any,@Param('id')id:string){return this.f.readNotification(r.user.id,id)}
 @Post('reports/:userId') report(@Req()r:any,@Param('userId')id:string,@Body()b:any){return this.f.report(r.user.id,id,b.reason,b.details)}
 @Post('blocks/:userId') block(@Req()r:any,@Param('userId')id:string){return this.f.block(r.user.id,id)}
 @Delete('blocks/:userId') unblock(@Req()r:any,@Param('userId')id:string){return this.f.unblock(r.user.id,id)}
 @Patch('password') password(@Req()r:any,@Body()b:{password:string}){return this.f.changePassword(r.user.id,b.password)}
 @Get('admin/dashboard') dashboard(@Req()r:any){this.f.ensureAdmin(r.user);return this.f.dashboard()}
 @Get('admin/users') users(@Req()r:any){this.f.ensureAdmin(r.user);return this.f.adminUsers()}
 @Patch('admin/users/:id/suspend') suspend(@Req()r:any,@Param('id')id:string,@Body()b:{suspended:boolean}){this.f.ensureAdmin(r.user);return this.f.suspend(id,b.suspended)}
 @Patch('admin/users/:id/verify') verify(@Req()r:any,@Param('id')id:string,@Body()b:{status:'VERIFIED'|'REJECTED'}){this.f.ensureAdmin(r.user);return this.f.verify(id,b.status)}
 @Get('admin/reports') reports(@Req()r:any){this.f.ensureAdmin(r.user);return this.f.reports()}
 @Get('admin/config') config(@Req()r:any){this.f.ensureAdmin(r.user);return this.f.config()}
 @Put('admin/config/:key') setConfig(@Req()r:any,@Param('key')key:string,@Body()b:{value:unknown}){this.f.ensureAdmin(r.user);return this.f.setConfig(key,b.value)}
}
