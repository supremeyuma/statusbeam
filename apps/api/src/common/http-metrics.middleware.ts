import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { MetricsService } from './metrics.service';

const SKIP_PATHS = new Set(['/healthz', '/readyz', '/metrics']);

@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  public constructor(private readonly metrics: MetricsService) {}

  public use(req: Request, res: Response, next: NextFunction): void {
    if (SKIP_PATHS.has(req.path)) {
      next();
      return;
    }

    const stopTimer = this.metrics.httpRequestDuration.startTimer();

    res.on('finish', () => {
      const routeValue: unknown = (req as unknown as { route?: { path?: unknown } }).route?.path;
      const route = typeof routeValue === 'string' ? routeValue : 'unmatched';
      stopTimer({
        method: req.method,
        route,
        status_code: String(res.statusCode),
      });
    });

    next();
  }
}
