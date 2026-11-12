import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { runWithRequestContext, sanitizeRequestId } from './request-context';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  public use(req: Request, res: Response, next: NextFunction): void {
    const fromHeader = sanitizeRequestId(req.header('x-request-id'));
    const fromPino = sanitizeRequestId(typeof req.id === 'string' ? req.id : undefined);
    const requestId = fromPino ?? fromHeader ?? randomUUID();

    req.id = requestId;
    res.setHeader('X-Request-ID', requestId);

    runWithRequestContext(requestId, next);
  }
}
