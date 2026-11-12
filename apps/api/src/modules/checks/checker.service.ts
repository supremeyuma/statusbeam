import { connect } from 'node:net';
import { Inject, Injectable } from '@nestjs/common';

import type { HttpMonitorConfig, TcpMonitorConfig } from '@statusbeam/contracts';
import { APP_CONFIG } from '../../common/config.module';
import type { AppConfig } from '../../common/config';
import type { Monitor } from '../../db/schema';
import { assertHttpTargetAllowed, assertTcpTargetAllowed } from '../monitors/ssrf';
import type { CheckErrorClass, CheckResult } from './check-result';

const BODY_SNIPPET_BYTES = 2048;

function deepCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    if (typeof current === 'object' && 'code' in current) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === 'string') {
        return code;
      }
    }
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined;
  }
  return undefined;
}

function classifyError(error: unknown): { errorClass: CheckErrorClass; message: string } {
  const name = error instanceof Error ? error.name : '';
  const code = deepCode(error);
  const message = error instanceof Error ? error.message : String(error);

  if (name === 'TimeoutError' || name === 'AbortError' || code === 'ETIMEDOUT') {
    return { errorClass: 'timeout', message };
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { errorClass: 'dns', message };
  }
  if (code === 'ECONNREFUSED') {
    return { errorClass: 'connection_refused', message };
  }
  if (
    code?.startsWith('ERR_TLS') ||
    code?.startsWith('CERT_') ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    message.includes('certificate')
  ) {
    return { errorClass: 'tls', message };
  }
  return { errorClass: 'unknown', message };
}

@Injectable()
export class CheckerService {
  public constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  public async check(monitor: Monitor): Promise<CheckResult> {
    if (monitor.type === 'http') {
      return this.checkHttp(monitor, monitor.config as unknown as HttpMonitorConfig);
    }
    return this.checkTcp(monitor.config as unknown as TcpMonitorConfig, monitor.timeoutMs);
  }

  private async checkHttp(monitor: Monitor, config: HttpMonitorConfig): Promise<CheckResult> {
    if (!this.config.allowPrivateTargets) {
      try {
        await assertHttpTargetAllowed(config.url, false);
      } catch (error) {
        return {
          ok: false,
          errorClass: 'unknown',
          latencyMs: 0,
          message: error instanceof Error ? error.message : 'target blocked by SSRF guard',
        };
      }
    }

    const started = performance.now();
    let response: Response;
    try {
      response = await fetch(config.url, {
        method: config.method,
        ...(config.headers ? { headers: config.headers } : {}),
        redirect: config.followRedirects ? 'follow' : 'manual',
        signal: AbortSignal.timeout(monitor.timeoutMs),
      });
    } catch (error) {
      const latencyMs = Math.round(performance.now() - started);
      const classified = classifyError(error);
      return { ok: false, ...classified, latencyMs };
    }

    const latencyMs = Math.round(performance.now() - started);
    let bodySnippet: string | undefined;
    if (config.method !== 'HEAD') {
      bodySnippet = (await response.text().catch(() => '')).slice(0, BODY_SNIPPET_BYTES);
    }

    const statusCode = response.status;
    if (!config.expectedStatus.includes(statusCode)) {
      return {
        ok: false,
        errorClass: 'http_status',
        latencyMs,
        statusCode,
        message: `unexpected status ${statusCode}, expected ${config.expectedStatus.join(', ')}`,
      };
    }

    if (config.bodyContains !== undefined && !bodySnippet?.includes(config.bodyContains)) {
      return {
        ok: false,
        errorClass: 'body_mismatch',
        latencyMs,
        statusCode,
        message: `response body did not contain "${config.bodyContains}"`,
      };
    }

    if (config.bodyRegex !== undefined) {
      let matches = false;
      try {
        matches = new RegExp(config.bodyRegex).test(bodySnippet ?? '');
      } catch {
        matches = false;
      }
      if (!matches) {
        return {
          ok: false,
          errorClass: 'body_mismatch',
          latencyMs,
          statusCode,
          message: `response body did not match /${config.bodyRegex}/`,
        };
      }
    }

    if (config.latencyThresholdMs !== undefined && latencyMs > config.latencyThresholdMs) {
      return {
        ok: false,
        errorClass: 'latency_exceeded',
        latencyMs,
        statusCode,
        message: `latency ${latencyMs}ms exceeded threshold ${config.latencyThresholdMs}ms`,
      };
    }

    return {
      ok: true,
      latencyMs,
      statusCode,
      ...(bodySnippet !== undefined ? { bodySnippet } : {}),
    };
  }

  private async checkTcp(config: TcpMonitorConfig, timeoutMs: number): Promise<CheckResult> {
    if (!this.config.allowPrivateTargets) {
      try {
        await assertTcpTargetAllowed(config.host, false);
      } catch (error) {
        return {
          ok: false,
          errorClass: 'unknown',
          latencyMs: 0,
          message: error instanceof Error ? error.message : 'target blocked by SSRF guard',
        };
      }
    }

    const started = performance.now();
    return new Promise<CheckResult>((resolve) => {
      const socket = connect({ host: config.host, port: config.port });
      let settled = false;

      const finish = (result: CheckResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(timeoutMs);
      socket.once('connect', () => {
        finish({ ok: true, latencyMs: Math.round(performance.now() - started) });
      });
      socket.once('timeout', () => {
        finish({
          ok: false,
          errorClass: 'timeout',
          latencyMs: Math.round(performance.now() - started),
          message: 'TCP connection timed out',
        });
      });
      socket.once('error', (error: NodeJS.ErrnoException) => {
        const classified = classifyError(error);
        finish({
          ok: false,
          errorClass: classified.errorClass,
          latencyMs: Math.round(performance.now() - started),
          message: classified.message,
        });
      });
    });
  }
}
