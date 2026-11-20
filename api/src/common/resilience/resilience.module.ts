import { Module, Global } from '@nestjs/common';
import { LoggingModule } from '../logging/logging.module';
import { CircuitBreakerService } from './circuit-breaker.service';

@Global()
@Module({
  imports: [LoggingModule],
  providers: [CircuitBreakerService],
  exports: [CircuitBreakerService],
})
export class ResilienceModule {}
