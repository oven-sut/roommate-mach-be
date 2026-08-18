import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import {
  EmailDto,
  ResetPasswordDto,
  ResetPasswordOtpDto,
  VerifyOtpDto,
} from './dto/email.dto';

/**
 * These are per-IP backstops against a single host spraying the API. They are
 * deliberately loose, because a university campus sits behind a handful of
 * NATed addresses and a strict per-IP limit would lock out real students.
 * The tight, per-account limits live where they belong: OtpService caps sends
 * and guesses per email address.
 */
const OTP_LIMIT = { default: { limit: 20, ttl: 60 * 60_000 } };
/** Password guessing and account enumeration. */
const CREDENTIAL_LIMIT = { default: { limit: 30, ttl: 15 * 60_000 } };
/** The signup form checks this on every keystroke (debounced). */
const LOOKUP_LIMIT = { default: { limit: 60, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('check-email')
  @Throttle(LOOKUP_LIMIT)
  @ApiOperation({ summary: 'Check whether an email is already registered' })
  checkEmailGet(@Query('email') email: string) {
    return this.authService.checkEmail(email);
  }

  @Post('check-email')
  @Throttle(LOOKUP_LIMIT)
  @HttpCode(HttpStatus.OK)
  checkEmailPost(@Body() dto: EmailDto) {
    return this.authService.checkEmail(dto.email);
  }

  @Post('send-otp')
  @Throttle(OTP_LIMIT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Email a one-time verification code' })
  sendOtp(@Body() dto: EmailDto) {
    return this.authService.sendOtp(dto.email);
  }

  @Post('resend-otp')
  @Throttle(OTP_LIMIT)
  @HttpCode(HttpStatus.OK)
  resendOtp(@Body() dto: EmailDto) {
    return this.authService.sendOtp(dto.email);
  }

  @Post('verify-otp')
  @Throttle(CREDENTIAL_LIMIT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a one-time code for a verified email' })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.email, dto.otp || dto.code || '');
  }

  @Post('verify-email')
  @Throttle(CREDENTIAL_LIMIT)
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.email, dto.otp || dto.code || '');
  }

  @Post('register')
  @Throttle(CREDENTIAL_LIMIT)
  @ApiOperation({ summary: 'Create an account (requires a verified email)' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @Throttle(CREDENTIAL_LIMIT)
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('google')
  @Throttle(CREDENTIAL_LIMIT)
  @HttpCode(HttpStatus.OK)
  googleLogin(@Body() dto: GoogleLoginDto) {
    return this.authService.googleLogin(dto);
  }

  @Post('forgot-password')
  @Throttle(OTP_LIMIT)
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: EmailDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @Throttle(CREDENTIAL_LIMIT)
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @Post('reset-password-otp')
  @Throttle(CREDENTIAL_LIMIT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a new password after verifying an OTP' })
  resetPasswordWithOtp(@Body() dto: ResetPasswordOtpDto) {
    return this.authService.resetPasswordWithOtp(dto.email, dto.password);
  }
}
