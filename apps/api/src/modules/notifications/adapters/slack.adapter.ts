import { Injectable } from '@nestjs/common';

import type { SlackChannelConfig } from '@statusbeam/contracts';
import {
  classifyHttpStatus,
  classifyNetworkError,
  type AdapterResult,
  type ChannelAdapter,
  type NotificationEvent,
} from './types';

const TIMEOUT_MS = 5000;

@Injectable()
export class SlackAdapter implements ChannelAdapter<SlackChannelConfig> {
  public async send(config: SlackChannelConfig, event: NotificationEvent): Promise<AdapterResult> {
    const payload = {
      text: `[${event.projectSlug}] ${event.monitorName}: ${event.status}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `${event.monitorName}: ${event.status}` },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Project*\n${event.projectSlug}` },
            { type: 'mrkdwn', text: `*Status*\n${event.status}` },
          ],
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: event.message },
        },
      ],
    };

    try {
      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const failure = classifyHttpStatus(response.status);
      return failure ?? { ok: true };
    } catch (error) {
      return classifyNetworkError(error);
    }
  }
}
