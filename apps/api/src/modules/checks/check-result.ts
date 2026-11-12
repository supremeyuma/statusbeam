export type CheckErrorClass =
  | 'timeout'
  | 'dns'
  | 'connection_refused'
  | 'tls'
  | 'http_status'
  | 'body_mismatch'
  | 'latency_exceeded'
  | 'unknown';

export interface CheckSuccess {
  ok: true;
  latencyMs: number;
  statusCode?: number;
  bodySnippet?: string;
}

export interface CheckFailure {
  ok: false;
  errorClass: CheckErrorClass;
  latencyMs: number;
  statusCode?: number;
  message: string;
}

export type CheckResult = CheckSuccess | CheckFailure;
