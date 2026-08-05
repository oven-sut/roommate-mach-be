import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { GoogleLoginDto } from './dto/google-login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('check-email')
  checkEmailGet(@Query('email') email: string) {
    return this.authService.checkEmail(email);
  }

  @Post('check-email')
  @HttpCode(HttpStatus.OK)
  checkEmailPost(@Body() dto: { email: string }) {
    return this.authService.checkEmail(dto.email);
  }

  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  sendOtp(@Body() dto: { email: string }) {
    return this.authService.sendOtp(dto.email);
  }

  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  resendOtp(@Body() dto: { email: string }) {
    return this.authService.sendOtp(dto.email);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  verifyOtp(@Body() dto: { email: string; otp: string; code?: string }) {
    return this.authService.verifyOtp(dto.email, dto.otp || dto.code || '');
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() dto: { email: string; otp: string; code?: string }) {
    return this.authService.verifyOtp(dto.email, dto.otp || dto.code || '');
  }

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  googleLogin(@Body() dto: GoogleLoginDto) {
    return this.authService.googleLogin(dto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: { email: string }) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: { token: string; password: string }) {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @Post('reset-password-otp')
  @HttpCode(HttpStatus.OK)
  resetPasswordWithOtp(@Body() dto: { email: string; password: string }) {
    return this.authService.resetPasswordWithOtp(dto.email, dto.password);
  }
}
