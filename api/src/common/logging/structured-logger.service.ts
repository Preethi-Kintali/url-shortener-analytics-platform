import { Injectable, LoggerService } from '@nestjs/common';
import { getCurrentRequestId } from '../middleware/request-id.util';
import { redactSensitiveText, sanitizeValue } from './redaction.util';

type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'verbose';

@Injectable()
export class StructuredLoggerService implements LoggerService {
  private readonly serviceName = 'url-shortener';

  private writeEntry(
    level: LogLevel,
    message: unknown,
    context?: string,
    extra?: Record<string, unknown>,
  ): void {
    const timestamp = new Date().toISOString();
    const entry: Record<string, unknown> = {
      timestamp,
      level,
      service_name: this.serviceName,
    };

    if (context) {
      entry.context = redactSensitiveText(context);
    }

    if (typeof message === 'object' && message !== null && !Array.isArray(message)) {
      Object.assign(entry, sanitizeValue(message) as Record<string, unknown>);
      if (!entry.message) {
        entry.message = (entry.event as string) || 'event logged';
      }
    } else {
      entry.message = redactSensitiveText(String(message));
    }

    if (extra) {
      Object.assign(entry, sanitizeValue(extra) as Record<string, unknown>);
    }

    if (entry.request_id === undefined) {
      const activeRequestId = getCurrentRequestId();
      entry.request_id = activeRequestId ? redactSensitiveText(activeRequestId) : 'system';
    }

    // Hybrid mode: pretty formatting in local development unless JSON is explicitly requested
    const isDev = process.env.NODE_ENV === 'development' || process.env.APP_ENV === 'development';
    const forceJson = process.env.FORCE_JSON_LOGS === 'true';

    if (isDev && !forceJson) {
      const color =
        level === 'error'
          ? '\x1b[31m'
          : level === 'warn'
            ? '\x1b[33m'
            : level === 'info'
              ? '\x1b[32m'
              : '\x1b[36m';
      const reset = '\x1b[0m';
      const prettyLine = `[${timestamp}] ${color}[${level.toUpperCase()}]${reset} [${this.serviceName}] [${entry.request_id}]: ${entry.message} ${JSON.stringify(
        Object.fromEntries(
          Object.entries(entry).filter(
            ([k]) => !['timestamp', 'level', 'service_name', 'request_id', 'message'].includes(k),
          ),
        ),
      )}\n`;

      if (level === 'error') {
        process.stderr.write(prettyLine);
      } else {
        process.stdout.write(prettyLine);
      }
      return;
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
    const resolvedContext =
      context ?? (traceOrContext && !traceOrContext.includes('\n') ? traceOrContext : undefined);
    const extra =
      traceOrContext && traceOrContext.includes('\n') ? { stack: traceOrContext } : undefined;
    this.writeEntry('error', message, resolvedContext, extra);
  }

  debug(message: unknown, context?: string): void {
    this.writeEntry('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.writeEntry('verbose', message, context);
  }
}
