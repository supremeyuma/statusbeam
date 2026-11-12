import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { collectDefaultMetrics, Histogram, Registry } from 'prom-client';

export type HttpMetricLabels = 'method' | 'route' | 'status_code';

@Injectable()
export class MetricsService implements OnModuleDestroy {
  public readonly registry = new Registry();
  public readonly httpRequestDuration: Histogram<HttpMetricLabels>;

  public constructor() {
    this.registry.setDefaultLabels({ service: 'statusbeam-api' });
    collectDefaultMetrics({ register: this.registry, prefix: 'statusbeam_' });

    this.httpRequestDuration = new Histogram({
      name: 'statusbeam_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
  }

  public get contentType(): string {
    return this.registry.contentType;
  }

  public async render(): Promise<string> {
    return this.registry.metrics();
  }

  public onModuleDestroy(): void {
    this.registry.clear();
  }
}
