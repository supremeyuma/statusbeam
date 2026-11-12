export interface NotificationEvent {
  incidentId: string;
  updateId: string;
  status: string;
  message: string;
  monitorId: string;
  monitorName: string;
  projectSlug: string;
  cause: string | null;
  occurredAt: string;
}

export interface AdapterSuccess {
  ok: true;
  skipped?: boolean;
}

export interface AdapterFailure {
  ok: false;
  retryable: boolean;
  errorClass: string;
  message: string;
}

export type AdapterResult = AdapterSuccess | AdapterFailure;

export interface ChannelAdapter<TConfig> {
  send(config: TConfig, event: NotificationEvent): Promise<AdapterResult>;
}

export function classifyHttpStatus(status: number): AdapterFailure | null {
  if (status >= 200 && status < 300) {
    return null;
  }
  return {
    ok: false,
    retryable: status >= 500 || status === 408 || status === 429,
    errorClass: `http_${status}`,
    message: `provider responded with HTTP ${status}`,
  };
}

export function classifyNetworkError(error: unknown): AdapterFailure {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  const timeout = name === 'TimeoutError' || name === 'AbortError';
  return {
    ok: false,
    retryable: true,
    errorClass: timeout ? 'timeout' : 'network',
    message,
  };
}
