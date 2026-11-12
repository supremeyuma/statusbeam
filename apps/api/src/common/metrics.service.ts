import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

export type HttpMetricLabels = 'method' | 'route' | 'status_code';
export type CheckMetricLabels = 'type' | 'status';

@Injectable()
export class MetricsService implements OnModuleDestroy {
  public readonly registry = new Registry();
  public readonly httpRequestDuration: Histogram<HttpMetricLabels>;
  public readonly checkDuration: Histogram<CheckMetricLabels>;
  public readonly checkSkipped: Counter<string>;
  public readonly schedulerLag: Histogram<string>;

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

    this.checkDuration = new Histogram({
      name: 'statusbeam_check_duration_seconds',
      help: 'Time spent running a monitor check',
      labelNames: ['type', 'status'],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
      registers: [this.registry],
    });

    this.checkSkipped = new Counter({
      name: 'statusbeam_check_skipped_total',
      help: 'Checks skipped because another worker held the monitor lock',
      registers: [this.registry],
    });

    this.schedulerLag = new Histogram({
      name: 'statusbeam_scheduler_lag_seconds',
      help: 'Seconds between the scheduled job timestamp and the worker starting it',
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
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
