import { createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';

import type { WebhookChannelConfig } from '@statusbeam/contracts';
import {
  classifyHttpStatus,
  classifyNetworkError,
  type AdapterResult,
  type ChannelAdapter,
  type NotificationEvent,
} from './types';

const TIMEOUT_MS = 5000;

@Injectable()
export class WebhookAdapter implements ChannelAdapter<WebhookChannelConfig> {
  public async send(
    config: WebhookChannelConfig,
    event: NotificationEvent,
  ): Promise<AdapterResult> {
    const body = JSON.stringify({
      event: 'incident_update',
      incidentId: event.incidentId,
      updateId: event.updateId,
      status: event.status,
      message: event.message,
      monitor: { id: event.monitorId, name: event.monitorName },
      project: { slug: event.projectSlug },
      cause: event.cause,
      occurredAt: event.occurredAt,
    });

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': 'StatusBeam/1.0',
    };

    if (config.secret) {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', config.secret)
        .update(`${timestamp}.${body}`)
        .digest('hex');
      headers['x-statusbeam-signature'] = `t=${timestamp},v1=${signature}`;
    }

    try {
      const response = await fetch(config.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const failure = classifyHttpStatus(response.status);
      return failure ?? { ok: true };
    } catch (error) {
      return classifyNetworkError(error);
    }
  }
}
