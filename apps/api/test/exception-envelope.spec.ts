import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';

import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { runWithRequestContext } from '../src/common/request-context';

function createHost(requestId = 'req-from-als') {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getResponse: () => ({ status, headersSent: false }),
      getRequest: () => ({
        method: 'GET',
        url: '/v1/monitors',
        originalUrl: '/v1/monitors',
        id: requestId,
        header: () => undefined,
      }),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  it('returns the standard envelope with the request id', () => {
    const originalError = console.error;
    console.error = () => undefined;
    try {
      const { host, status, json } = createHost('req-123');
      const filter = new AllExceptionsFilter();

      runWithRequestContext('req-123', () => {
        filter.catch(new BadRequestException('bad input'), host);
      });

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: 'bad input',
          requestId: 'req-123',
          path: '/v1/monitors',
        }),
      );
    } finally {
      console.error = originalError;
    }
  });
});
