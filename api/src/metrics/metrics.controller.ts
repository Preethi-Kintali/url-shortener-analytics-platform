import { Controller, Get, Header, Res, HttpException, HttpStatus } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { HttpResponseLike } from '../common/middleware/request-id.util';
import { MetricsService } from './metrics.service';

@Controller()
@SkipThrottle()
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(@Res({ passthrough: true }) res: HttpResponseLike): Promise<string> {
    res.setHeader('Content-Type', this.metricsService.getContentType());
    return this.metricsService.getMetrics();
  }

  /**
   * Diagnostic test endpoint to simulate a 500 error for failure-first observability verification
   */
  @Get('debug/error')
  triggerError(): void {
    throw new HttpException(
      'Simulated internal server error for failure-first observability drill',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
