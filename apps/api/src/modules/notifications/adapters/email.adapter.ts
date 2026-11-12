import { Inject, Injectable } from '@nestjs/common';
import { createTransport } from 'nodemailer';

import type { EmailChannelConfig } from '@statusbeam/contracts';
import { APP_CONFIG } from '../../../common/config.module';
import type { AppConfig } from '../../../common/config';
import {
  classifyHttpStatus,
  classifyNetworkError,
  type AdapterResult,
  type ChannelAdapter,
  type NotificationEvent,
} from './types';

const TIMEOUT_MS = 5000;

@Injectable()
export class EmailAdapter implements ChannelAdapter<EmailChannelConfig> {
  public constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  public async send(config: EmailChannelConfig, event: NotificationEvent): Promise<AdapterResult> {
    const subject = `[StatusBeam] ${event.projectSlug}: ${event.monitorName} ${event.status}`;
    const text = `${event.monitorName} is ${event.status}.\n\n${event.message}\n\nProject: ${event.projectSlug}\nCause: ${event.cause ?? 'n/a'}\nAt: ${event.occurredAt}`;

    if (this.config.resendApiKey) {
      return this.sendWithResend(this.config.resendApiKey, config.to, subject, text);
    }

    if (this.config.smtpUrl) {
      return this.sendWithSmtp(this.config.smtpUrl, config.to, subject, text);
    }

    return { ok: true, skipped: true };
  }

  private async sendWithResend(
    apiKey: string,
    to: string,
    subject: string,
    text: string,
  ): Promise<AdapterResult> {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.config.mailFrom,
          to: [to],
          subject,
          text,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const failure = classifyHttpStatus(response.status);
      return failure ?? { ok: true };
    } catch (error) {
      return classifyNetworkError(error);
    }
  }

  private async sendWithSmtp(
    smtpUrl: string,
    to: string,
    subject: string,
    text: string,
  ): Promise<AdapterResult> {
    try {
      const transport = createTransport(smtpUrl);
      await transport.sendMail({ from: this.config.mailFrom, to, subject, text });
      return { ok: true };
    } catch (error) {
      return classifyNetworkError(error);
    }
  }
}
