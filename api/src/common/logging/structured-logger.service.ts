import { Injectable, LoggerService } from '@nestjs/common';
import { getCurrentRequestId } from '../middleware/request-id.util';
import { redactSensitiveText, sanitizeValue } from './redaction.util';

type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'verbose';

@Injectable()
export class StructuredLoggerService implements LoggerService {
  private writeEntry(
    level: LogLevel,
    message: unknown,
    context?: string,
    extra?: Record<string, unknown>,
  ): void {
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
    };

    if (context) {
      entry.context = redactSensitiveText(context);
    }

    if (typeof message === 'object' && message !== null && !Array.isArray(message)) {
      Object.assign(entry, sanitizeValue(message) as Record<string, unknown>);
    } else {
      entry.message = redactSensitiveText(String(message));
    }

    if (extra) {
      Object.assign(entry, sanitizeValue(extra) as Record<string, unknown>);
    }

    if (entry.request_id === undefined) {
      const activeRequestId = getCurrentRequestId();
      if (activeRequestId) {
        entry.request_id = redactSensitiveText(activeRequestId);
      }
    }

    const line = `${JSON.stringify(entry)}\n`;
    if (level === 'error') {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  }

  log(message: unknown, context?: string): void {
    this.writeEntry('info', message, context);
  }

  info(message: unknown, context?: string): void {
    this.writeEntry('info', message, context);
  }

  warn(message: unknown, context?: string): void {
    this.writeEntry('warn', message, context);
  }

  error(message: unknown, traceOrContext?: string, context?: string): void {
    const resolvedContext = context ?? (traceOrContext && !traceOrContext.includes('\n') ? traceOrContext : undefined);
    this.writeEntry('error', message, resolvedContext);
  }

  debug(message: unknown, context?: string): void {
    this.writeEntry('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.writeEntry('verbose', message, context);
  }
}

