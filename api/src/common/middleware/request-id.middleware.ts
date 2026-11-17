import { Injectable, NestMiddleware } from '@nestjs/common';
import { sanitizeRoutePath } from '../logging/redaction.util';
import { StructuredLoggerService } from '../logging/structured-logger.service';
import {
  computeLatencyMs,
  HttpResponseLike,
  RequestWithContext,
  resolveOrCreateRequestId,
  runWithRequestId,
} from './request-id.util';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(private readonly logger: StructuredLoggerService) {}

  use(req: RequestWithContext, res: HttpResponseLike, next: () => void): void {
    const requestId = resolveOrCreateRequestId(req, res);
    req.requestStartNs = process.hrtime.bigint();

    if (!req.requestLoggerAttached) {
      req.requestLoggerAttached = true;
      res.on('finish', () => {
        const statusCode = res.statusCode;
        const latencyMs = computeLatencyMs(req.requestStartNs);
        const route = sanitizeRoutePath(req.originalUrl || req.url);
        const errorCode =
          typeof res.locals?.errorCode === 'string' ? res.locals.errorCode : undefined;

        const payload: Record<string, unknown> = {
          event: 'http_request',
          request_id: requestId,
          method: req.method,
          route,
          status_code: statusCode,
          latency_ms: latencyMs,
        };

        if (errorCode) {
          payload.error_code = errorCode;
        }

        if (statusCode >= 500) {
          this.logger.error(payload, undefined, 'HTTP');
        } else if (statusCode >= 400) {
          this.logger.warn(payload, 'HTTP');
        } else {
          this.logger.log(payload, 'HTTP');
        }
      });
    }

    runWithRequestId(requestId, () => next());
  }
}
