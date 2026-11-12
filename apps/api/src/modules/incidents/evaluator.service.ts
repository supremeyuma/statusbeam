import { Inject, Injectable, Logger } from '@nestjs/common';
import { desc, eq, isNull, and } from 'drizzle-orm';

import type { IncidentResponse } from '@statusbeam/contracts';
import { DATABASE } from '../../db/database.module';
import type { Database } from '../../db/client';
import { checks, incidents, incidentUpdates, monitors } from '../../db/schema';
import type { Incident as IncidentRow } from '../../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { StatusEventsService } from '../status/status-events.service';

const RECENT_WINDOW = 20;
const RESOLVE_AFTER_SUCCESSES = 2;

export function toIncidentResponse(row: IncidentRow): IncidentResponse {
  return {
    id: row.id,
    monitorId: row.monitorId,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    cause: row.cause,
  };
}

export interface EvaluateResult {
  opened: IncidentResponse | null;
  resolved: IncidentResponse | null;
}

@Injectable()
export class IncidentEvaluator {
  private readonly logger = new Logger(IncidentEvaluator.name);

  public constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly notifications: NotificationsService,
    private readonly statusEvents: StatusEventsService,
  ) {}

  /**
   * Runs after every check insert. Uses the recent check window for hysteresis: open only
   * after `retries` consecutive failures, resolve only after two consecutive successes.
   */
  public async evaluate(monitorId: string): Promise<EvaluateResult> {
    const monitorRows = await this.db
      .select()
      .from(monitors)
      .where(eq(monitors.id, monitorId))
      .limit(1);
    const monitor = monitorRows[0];
    if (!monitor) {
      return { opened: null, resolved: null };
    }

    const recent = await this.db
      .select()
      .from(checks)
      .where(eq(checks.monitorId, monitorId))
      .orderBy(desc(checks.checkedAt), desc(checks.id))
      .limit(RECENT_WINDOW);

    let consecutiveFailures = 0;
    for (const check of recent) {
      if (check.status !== 'down') {
        break;
      }
      consecutiveFailures += 1;
    }

    let consecutiveSuccesses = 0;
    for (const check of recent) {
      if (check.status !== 'up') {
        break;
      }
      consecutiveSuccesses += 1;
    }

    const openRows = await this.db
      .select()
      .from(incidents)
      .where(and(eq(incidents.monitorId, monitorId), isNull(incidents.resolvedAt)))
      .limit(1);
    const open = openRows[0];

    if (!open && consecutiveFailures >= monitor.retries) {
      const latestFailure = recent.find((check) => check.status === 'down');
      const cause = (latestFailure?.error ?? 'monitor failed repeatedly').slice(0, 500);

      const inserted = await this.db
        .insert(incidents)
        .values({ monitorId, status: 'investigating', cause })
        .returning();
      const incident = inserted[0];
      if (!incident) {
        return { opened: null, resolved: null };
      }

      await this.appendUpdate(incident.id, 'investigating', `Incident opened: ${cause}`);
      this.logger.warn(`incident ${incident.id} opened for monitor ${monitorId}`);
      await this.statusEvents.publish(monitor.projectId, 'incident', {
        incidentId: incident.id,
        monitorId,
        status: 'investigating',
        cause,
        occurredAt: incident.startedAt.toISOString(),
      });
      return { opened: toIncidentResponse(incident), resolved: null };
    }

    if (open && consecutiveSuccesses >= RESOLVE_AFTER_SUCCESSES) {
      const now = new Date();
      const updatedRows = await this.db
        .update(incidents)
        .set({ status: 'resolved', resolvedAt: now })
        .where(eq(incidents.id, open.id))
        .returning();
      const updated = updatedRows[0];
      if (!updated) {
        return { opened: null, resolved: null };
      }

      await this.appendUpdate(
        updated.id,
        'resolved',
        `Recovered after ${consecutiveSuccesses} consecutive successful checks.`,
      );
      this.logger.log(`incident ${updated.id} resolved for monitor ${monitorId}`);
      await this.statusEvents.publish(monitor.projectId, 'incident', {
        incidentId: updated.id,
        monitorId,
        status: 'resolved',
        cause: updated.cause,
        occurredAt: now.toISOString(),
      });
      return { opened: null, resolved: toIncidentResponse(updated) };
    }

    return { opened: null, resolved: null };
  }

  private async appendUpdate(
    incidentId: string,
    status: IncidentResponse['status'],
    message: string,
  ): Promise<void> {
    const rows = await this.db
      .insert(incidentUpdates)
      .values({ incidentId, status, message, actor: 'system' })
      .returning();
    const update = rows[0];
    if (update) {
      await this.notifications.enqueueForUpdate(update);
    }
  }
}
