import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { GoogleLoginDto } from './dto/google-login.dto';

@Injectable()
export class AuthService {
  private readonly googleClient = new OAuth2Client();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException('This email is already registered');
    }

    try {
      const user = await this.prisma.user.create({
        data: {
          displayName: dto.displayName,
          email: dto.email,
          passwordHash: await hash(dto.password, 12),
        },
        select: {
          id: true,
          displayName: true,
          email: true,
          createdAt: true,
        },
      });

      return this.buildAuthResponse(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('This email is already registered');
      }
      throw error;
    }
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user?.passwordHash || !(await compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.buildAuthResponse({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      createdAt: user.createdAt,
    });
  }

  async googleLogin(dto: GoogleLoginDto) {
    const audiences = process.env.GOOGLE_CLIENT_IDS?.split(',')
      .map((clientId) => clientId.trim())
      .filter(Boolean);

    if (!audiences?.length) {
      throw new UnauthorizedException('Google Sign-In is not configured');
    }

    let payload;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: dto.idToken,
        audience: audiences,
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google ID token');
    }

    if (!payload?.sub || !payload.email || !payload.email_verified) {
      throw new UnauthorizedException('Google account email is not verified');
    }

    const email = payload.email.toLowerCase();
    if (!email.endsWith('@g.sut.ac.th')) {
      throw new UnauthorizedException('Only SUT student accounts are allowed');
    }

    const existingByGoogleId = await this.prisma.user.findFirst({
      where: { googleId: payload.sub },
    });
    const existingByEmail = existingByGoogleId
      ? null
      : await this.prisma.user.findUnique({ where: { email } });

    const user = existingByGoogleId
      ? existingByGoogleId
      : existingByEmail
        ? await this.prisma.user.update({
            where: { id: existingByEmail.id },
            data: { googleId: payload.sub },
          })
        : await this.prisma.user.create({
            data: {
              googleId: payload.sub,
              email,
              displayName: payload.name?.trim() || email.split('@')[0],
            },
          });

    return this.buildAuthResponse({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      createdAt: user.createdAt,
    });
  }

  private async buildAuthResponse(user: {
    id: string;
    displayName: string;
    email: string;
    createdAt: Date;
  }) {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      user,
    };
  }
}
