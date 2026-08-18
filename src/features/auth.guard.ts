import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** What `buildAuthResponse` signs into the token. */
type JwtPayload = { sub: string; email: string };

/** The request, once this guard has attached the account it belongs to. */
export type AuthenticatedRequest = Request & { user: User };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('Authentication required');

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });
      // A suspended account keeps a valid token until it expires, so the check
      // has to happen on every request rather than only at sign-in.
      if (!user || user.suspended)
        throw new UnauthorizedException('Account unavailable');
      request.user = user;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
