import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
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

    if (!user || !(await compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

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
