import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { StructuredLoggerService } from './common/logging/structured-logger.service';
import { validateEnv } from './config/validate-env';

async function bootstrap() {
  // Fail-fast environment validation occurs strictly before NestFactory creates app or binds port
  const env = validateEnv();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(StructuredLoggerService);
  app.useLogger(logger);

  // Enable graceful shutdown hooks so Nest intercepts SIGTERM/SIGINT and calls OnModuleDestroy
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Explicitly bind to 0.0.0.0 for containerized platforms (Railway, Docker)
  await app.listen(env.port, '0.0.0.0');
  logger.log({ event: 'server_started', port: env.port, host: '0.0.0.0' }, 'Bootstrap');
}

bootstrap().catch((error) => {
  const logger = new StructuredLoggerService();
  logger.error(
    {
      event: 'bootstrap_failed',
      message: error instanceof Error ? error.message : String(error),
    },
    undefined,
    'Bootstrap',
  );
  process.exit(1);
});
