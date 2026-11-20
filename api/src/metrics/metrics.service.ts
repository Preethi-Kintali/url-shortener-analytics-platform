import { Injectable, OnModuleInit } from '@nestjs/common';
import * as client from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly registry: client.Registry;
  public readonly httpRequestsTotal: client.Counter<'method' | 'path' | 'status'>;
  public readonly httpRequestDurationSeconds: client.Histogram<'method' | 'path' | 'status'>;
  public readonly activeConnections: client.Gauge<string>;
  public readonly urlsTotal: client.Gauge<string>;

  constructor() {
    this.registry = new client.Registry();

    // Default Node.js process & system metrics (CPU, memory, event loop)
    client.collectDefaultMetrics({ register: this.registry, prefix: 'node_' });

    this.httpRequestsTotal = new client.Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests processed by the application',
      labelNames: ['method', 'path', 'status'],
      registers: [this.registry],
    });

    this.httpRequestDurationSeconds = new client.Histogram({
      name: 'http_request_duration_seconds',
      help: 'Histogram of HTTP request durations in seconds',
      labelNames: ['method', 'path', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.activeConnections = new client.Gauge({
      name: 'active_connections',
      help: 'Number of active HTTP requests currently being handled',
      registers: [this.registry],
    });

    this.urlsTotal = new client.Gauge({
      name: 'urls_total',
      help: 'Total count of shortened URLs managed by the platform',
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    this.activeConnections.set(0);
    this.urlsTotal.set(42);
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}
