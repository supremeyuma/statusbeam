import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import type {
  EmailChannelConfig,
  SlackChannelConfig,
  WebhookChannelConfig,
} from '@statusbeam/contracts';
import { DATABASE } from '../../db/database.module';
import type { Database } from '../../db/client';
import { channels, incidentUpdates, incidents, monitors, projects } from '../../db/schema';
import { EmailAdapter } from './adapters/email.adapter';
import { SlackAdapter } from './adapters/slack.adapter';
import { WebhookAdapter } from './adapters/webhook.adapter';
import type { AdapterResult, NotificationEvent } from './adapters/types';
import { MetricsService } from '../../common/metrics.service';

export type DeliveryOutcome = AdapterResult;

@Injectable()
export class NotificationProcessor {
  public constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly webhook: WebhookAdapter,
    private readonly slack: SlackAdapter,
    private readonly email: EmailAdapter,
    private readonly metrics: MetricsService,
  ) {}

  public async deliver(updateId: string, channelId: string): Promise<DeliveryOutcome> {
    const updateRows = await this.db
      .select()
      .from(incidentUpdates)
      .where(eq(incidentUpdates.id, updateId))
      .limit(1);
    const update = updateRows[0];
    if (!update) {
      return { ok: true, skipped: true };
    }

    const incidentRows = await this.db
      .select()
      .from(incidents)
      .where(eq(incidents.id, update.incidentId))
      .limit(1);
    const incident = incidentRows[0];
    if (!incident) {
      return { ok: true, skipped: true };
    }

    const monitorRows = await this.db
      .select()
      .from(monitors)
      .where(eq(monitors.id, incident.monitorId))
      .limit(1);
    const monitor = monitorRows[0];
    if (!monitor) {
      return { ok: true, skipped: true };
    }

    const projectRows = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, monitor.projectId))
      .limit(1);
    const project = projectRows[0];
    if (!project) {
      return { ok: true, skipped: true };
    }

    const channelRows = await this.db
      .select()
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1);
    const channel = channelRows[0];
    if (!channel || !channel.active) {
      return { ok: true, skipped: true };
    }

    const event: NotificationEvent = {
      incidentId: incident.id,
      updateId: update.id,
      status: update.status,
      message: update.message,
      monitorId: monitor.id,
      monitorName: monitor.name,
      projectSlug: project.slug,
      cause: incident.cause,
      occurredAt: update.createdAt.toISOString(),
    };

    let result: AdapterResult;
    switch (channel.type) {
      case 'webhook':
        result = await this.webhook.send(channel.config as unknown as WebhookChannelConfig, event);
        break;
      case 'slack':
        result = await this.slack.send(channel.config as unknown as SlackChannelConfig, event);
        break;
      case 'email':
        result = await this.email.send(channel.config as unknown as EmailChannelConfig, event);
        break;
      default:
        result = { ok: true, skipped: true };
    }

    this.metrics.notificationSent.inc({
      type: channel.type,
      status: result.ok ? (result.skipped ? 'skipped' : 'ok') : 'failed',
    });

    return result;
  }
}
