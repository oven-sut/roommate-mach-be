import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import helmet from 'helmet';

/**
 * Everything that turns a bare Nest application into this API.
 *
 * Shared by `main.ts` (a long-running server) and `serverless.ts` (a Vercel
 * function) so the two cannot drift apart — a security header or a validation
 * rule that only applies to one of them is worse than not having it.
 */

/** Uploads arrive as base64 data URIs, which is why the limit is this high. */
const BODY_LIMIT = '12mb';

export const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * In development the app is loaded from an Expo dev server on an arbitrary LAN
 * address, so any origin is allowed. In production only the origins listed in
 * CORS_ORIGINS are, since `credentials: true` with a reflected origin would let
 * any site call the API with a signed-in user's cookies.
 */
export function corsOrigin(production: boolean) {
  const configured = process.env.CORS_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!production) return true;
  if (configured?.length) return configured;

  // Native apps send no Origin header, so a closed list still works for them.
  return false;
}

/** Refuses to start with a configuration that would be unsafe in production. */
export function assertSafeConfig(production: boolean) {
  if (production && process.env.ALLOW_DEV_OTP === 'true') {
    throw new Error('ALLOW_DEV_OTP must not be true when NODE_ENV=production');
  }
  const secret = process.env.JWT_SECRET ?? '';
  if (production && secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production');
  }
  if (production && secret.includes('replace-this')) {
    throw new Error('JWT_SECRET is still the example value');
  }
}

export function configureApp(app: NestExpressApplication) {
  const production = isProduction();

  app.use(json({ limit: BODY_LIMIT }));
  app.use(urlencoded({ limit: BODY_LIMIT, extended: true }));
  app.use(
    helmet({
      // Images are served from object storage on another origin.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: production ? undefined : false,
    }),
  );
  app.set('trust proxy', 1);

  app.enableCors({
    origin: corsOrigin(production),
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    optionsSuccessStatus: 204,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Publishing the full API surface publicly is not something production needs.
  if (!production || process.env.ENABLE_SWAGGER === 'true') {
    const config = new DocumentBuilder()
      .setTitle('Roommate Match API')
      .setDescription('Auth, profiles, matching, chat and admin for the app.')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(app, config),
    );
  }

  return app;
}

export const bootstrapLogger = new Logger('Bootstrap');
