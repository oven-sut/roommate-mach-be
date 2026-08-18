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

/** `url.parse()` is deprecated; Node reports it under this code. */
const URL_PARSE_DEPRECATION = 'DEP0169';

/**
 * Drops one deprecation warning that Vercel's own request bridge triggers.
 *
 * The bridge calls the deprecated `url.parse()` before our code ever runs, so
 * Node prints DEP0169 on every cold start. It goes to stderr, which the log
 * viewer colours as an error, and it says nothing about this application or
 * anything anyone here can act on.
 *
 * Filtered by code rather than with `--no-deprecation`, so a deprecation
 * warning from our own dependencies still gets through and still gets noticed.
 */
function ignorePlatformUrlParseWarning() {
  // `process.emitWarning` has four overloads, and binding an overloaded
  // function widens it to `any` - there is no signature that both satisfies
  // the checker and accepts every shape Node calls it with. The arguments are
  // passed straight back through untouched.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const emitWarning: (warning: string | Error, ...rest: unknown[]) => void =
    process.emitWarning.bind(process);

  const codeOf = (warning: unknown, rest: unknown[]): string | undefined => {
    // emitWarning(warning, type, code) and emitWarning(warning, options) are
    // both valid, so the code can arrive in either shape.
    for (const arg of rest) {
      if (typeof arg === 'string' && arg.startsWith('DEP')) return arg;
      if (arg && typeof arg === 'object' && 'code' in arg) {
        return (arg as { code?: string }).code;
      }
    }
    if (warning && typeof warning === 'object' && 'code' in warning) {
      return (warning as { code?: string }).code;
    }
    return undefined;
  };

  process.emitWarning = (warning: string | Error, ...rest: unknown[]) => {
    if (codeOf(warning, rest) === URL_PARSE_DEPRECATION) return;
    emitWarning(warning, ...rest);
  };
}

ignorePlatformUrlParseWarning();

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
