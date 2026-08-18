import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

type Check = { status: 'up' | 'down'; error?: string };

/**
 * Liveness and readiness for container orchestration.
 *
 * `/health` answers as long as the process is running; `/health/ready` also
 * proves the database and object storage are reachable and returns 503 if not,
 * so a broken instance is taken out of rotation instead of serving errors.
 */
@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe' })
  live() {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe: database and object storage' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const [database, storage] = await Promise.all([
      this.check(() => this.prisma.$queryRaw`SELECT 1`),
      this.check(() => this.storage.ping()),
    ]);

    const healthy = database.status === 'up' && storage.status === 'up';
    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return {
      status: healthy ? 'ok' : 'degraded',
      checks: { database, storage },
      timestamp: new Date().toISOString(),
    };
  }

  private async check(probe: () => Promise<unknown>): Promise<Check> {
    try {
      await probe();
      return { status: 'up' };
    } catch (error) {
      return { status: 'down', error: (error as Error).message };
    }
  }
}
