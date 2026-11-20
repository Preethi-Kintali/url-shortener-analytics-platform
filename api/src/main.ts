import 'reflect-metadata';
// Fail-fast schema validation runs strictly before routes, middleware, or connections
import { config } from './config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { StructuredLoggerService } from './common/logging/structured-logger.service';

async function bootstrap() {
  // Announce active environment and configuration without logging secrets
  console.log(
    JSON.stringify({
      message: 'Service starting',
      environment: config.NODE_ENV,
      port: config.PORT,
      log_level: config.LOG_LEVEL,
      // NOTE: Do NOT log DATABASE_URL, JWT_SECRET, or any sensitive value
    }),
  );

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(StructuredLoggerService);
  app.useLogger(logger);

  // Enable CORS with configured origin
  app.enableCors({
    origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN,
  });

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
  await app.listen(config.PORT, '0.0.0.0');
  logger.log(
    { event: 'server_started', port: config.PORT, host: '0.0.0.0', environment: config.NODE_ENV },
    'Bootstrap',
  );
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
