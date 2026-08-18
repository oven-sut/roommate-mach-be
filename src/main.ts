import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import {
  assertSafeConfig,
  bootstrapLogger,
  configureApp,
  isProduction,
} from './bootstrap';

/** Long-running server entry point (local dev, Docker, any container host). */
async function bootstrap() {
  assertSafeConfig(isProduction());

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  configureApp(app);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  bootstrapLogger.log(`API listening on port ${port}`);
}

void bootstrap();
