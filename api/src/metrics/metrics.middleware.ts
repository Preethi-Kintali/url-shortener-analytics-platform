import { Injectable, NestMiddleware } from '@nestjs/common';
import { HttpRequestLike, HttpResponseLike } from '../common/middleware/request-id.util';
import { MetricsService } from './metrics.service';
import { sanitizeRoutePath } from '../common/logging/redaction.util';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metricsService: MetricsService) {}

  use(req: HttpRequestLike, res: HttpResponseLike, next: () => void): void {
    const startTime = process.hrtime();
    this.metricsService.activeConnections.inc();

    res.on('finish', () => {
      this.metricsService.activeConnections.dec();

      const diff = process.hrtime(startTime);
      const durationSeconds = diff[0] + diff[1] / 1e9;

      const method = req.method;
      const path = sanitizeRoutePath(req.originalUrl || req.url || '/');
      const status = String(res.statusCode);

      this.metricsService.httpRequestsTotal.inc({ method, path, status });
      this.metricsService.httpRequestDurationSeconds.observe({ method, path, status }, durationSeconds);
    });

    next();
  }
}
