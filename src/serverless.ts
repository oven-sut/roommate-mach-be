import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import type { Request, Response } from 'express';
import { AppModule } from './app.module';
import { assertSafeConfig, configureApp, isProduction } from './bootstrap';

/**
 * Vercel entry point.
 *
 * A serverless function is invoked per request but the container is reused, so
 * the Nest application is built once and the promise cached. Concurrent cold
 * requests all await the same bootstrap rather than each building their own.
 *
 * Note `app.init()` rather than `app.listen()` — the platform owns the socket.
 */

const server = express();
let bootstrapping: Promise<NestExpressApplication> | null = null;

async function bootstrap(): Promise<NestExpressApplication> {
  assertSafeConfig(isProduction());

  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(server),
    { bodyParser: false },
  );
  configureApp(app);
  await app.init();
  return app;
}

export default async function handler(req: Request, res: Response) {
  try {
    bootstrapping ??= bootstrap();
    await bootstrapping;
  } catch (error) {
    // A failed bootstrap must not be cached, or every later request in this
    // container fails with it long after the cause is fixed.
    bootstrapping = null;

    console.error('Failed to start the API', error);
    res.status(503).json({
      statusCode: 503,
      message: 'The API is not available. Check the server configuration.',
    });
    return;
  }

  server(req, res);
}
