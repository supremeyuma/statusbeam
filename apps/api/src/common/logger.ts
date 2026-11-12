import { randomUUID } from 'node:crypto';
import type { Params } from 'nestjs-pino';

import type { AppConfig } from './config';
import { getRequestId, sanitizeRequestId } from './request-context';

export function buildPinoOptions(config: AppConfig): Params {
  const transport =
    config.nodeEnv === 'development'
      ? {
          target: 'pino-pretty',
          options: { singleLine: true, colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
        }
      : undefined;

  return {
    pinoHttp: {
      level: config.logLevel,
      genReqId: (req, res) => {
        const header = req.headers['x-request-id'];
        const requestId =
          sanitizeRequestId(typeof header === 'string' ? header : undefined) ??
          sanitizeRequestId(typeof req.id === 'string' ? req.id : undefined) ??
          randomUUID();
        res.setHeader('X-Request-ID', requestId);
        return requestId;
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-api-key"]',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
      autoLogging: {
        ignore: (req) => {
          const url = req.url ?? '';
          return url === '/healthz' || url === '/readyz' || url === '/metrics';
        },
      },
      customProps: () => ({ requestId: getRequestId() }),
      ...(transport ? { transport } : {}),
    },
  };
}
