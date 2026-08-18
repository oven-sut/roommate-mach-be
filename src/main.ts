import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';

/**
 * In development the app is loaded from an Expo dev server on an arbitrary LAN
 * address, so any origin is allowed. In production only the origins listed in
 * CORS_ORIGINS are, since `credentials: true` with a reflected origin would let
 * any site call the API with a signed-in user's cookies.
 */
function corsOrigin(production: boolean) {
  const configured = process.env.CORS_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!production) return true;
  if (configured?.length) return configured;

  // Native apps send no Origin header, so a closed list still works for them.
  return false;
}

function assertSafeConfig(production: boolean) {
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

async function bootstrap() {
  const production = process.env.NODE_ENV === 'production';
  assertSafeConfig(production);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // Uploads arrive as base64 data URIs, which is why the limit is this high.
  app.use(json({ limit: '12mb' }));
  app.use(urlencoded({ limit: '12mb', extended: true }));
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

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on port ${port}`);
}

void bootstrap();
