import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { redactSensitiveText } from '../common/logging/redaction.util';
import { StructuredLoggerService } from '../common/logging/structured-logger.service';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly logger: StructuredLoggerService) {
    super();
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log({ event: 'db_connected', status: 'ok' }, 'PrismaService');
    } catch (error) {
      const safeDetail = redactSensitiveText(
        error instanceof Error ? error.message : 'Database connection initialization failed',
      );
      this.logger.warn(
        {
          event: 'db_initial_connect_failed',
          status: 'degraded',
          detail: safeDetail,
        },
        'PrismaService',
      );
    }
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
    } catch (error) {
      const safeDetail = redactSensitiveText(
        error instanceof Error ? error.message : 'Database disconnect failed',
      );
      this.logger.warn({ event: 'db_disconnect_failed', detail: safeDetail }, 'PrismaService');
    }
  }

  async ping(timeoutMs = 2000): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.$queryRaw`SELECT 1`.then(() => true),
        new Promise<boolean>((_, reject) => {
          timer = setTimeout(() => reject(new Error('DB ping timeout')), timeoutMs);
        }),
      ]);
    } catch {
      return false;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}

