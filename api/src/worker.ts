import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { StructuredLoggerService } from './common/logging/structured-logger.service';
import { validateEnv } from './config/validate-env';
import { WorkerModule } from './worker.module';

async function bootstrapWorker(): Promise<void> {
  // Validate critical env config (DATABASE_URL/JWT/PORT) consistently before booting worker.
  validateEnv();

  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  const logger = app.get(StructuredLoggerService);
  app.useLogger(logger);

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) {
      return;
    }
    closing = true;
    logger.log({ event: 'worker_shutdown_signal', signal }, 'WorkerBootstrap');
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      logger.error(
        {
          event: 'worker_shutdown_error',
          message: error instanceof Error ? error.message : String(error),
        },
        undefined,
        'WorkerBootstrap',
      );
      process.exit(1);
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('message', (msg) => {
    if (msg === 'shutdown') {
      void shutdown('IPC_SHUTDOWN');
    }
  });
}

bootstrapWorker().catch((error) => {
  const logger = new StructuredLoggerService();
  logger.error(
    {
      event: 'worker_bootstrap_failed',
      message: error instanceof Error ? error.message : String(error),
    },
    undefined,
    'WorkerBootstrap',
  );
  process.exit(1);
});

