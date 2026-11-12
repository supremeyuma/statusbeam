import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';

import type {
  IncidentDetailResponse,
  IncidentResponse,
  IncidentUpdateInput,
  IncidentUpdateResponse,
} from '@statusbeam/contracts';
import type { AuthPrincipal } from '../../common/auth-principal';
import { DATABASE } from '../../db/database.module';
import type { Database } from '../../db/client';
import { incidentUpdates, incidents, monitors } from '../../db/schema';
import type { Incident as IncidentRow } from '../../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { ProjectsService } from '../projects/projects.service';
import { assertTransition } from './state-machine';
import { toIncidentResponse } from './evaluator.service';

function toUpdateResponse(row: typeof incidentUpdates.$inferSelect): IncidentUpdateResponse {
  return {
    id: row.id,
    incidentId: row.incidentId,
    status: row.status,
    message: row.message,
    actor: row.actor,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class IncidentsService {
  public constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
    private readonly notifications: NotificationsService,
  ) {}

  public async listForProject(auth: AuthPrincipal, projectId: string): Promise<IncidentResponse[]> {
    await this.projects.assertAccess(auth, projectId);
    const rows = await this.db
      .select({ incident: incidents })
      .from(incidents)
      .innerJoin(monitors, eq(incidents.monitorId, monitors.id))
      .where(eq(monitors.projectId, projectId))
      .orderBy(desc(incidents.startedAt))
      .limit(100);
    return rows.map((row) => toIncidentResponse(row.incident));
  }

  public async get(auth: AuthPrincipal, id: string): Promise<IncidentDetailResponse> {
    const incident = await this.findAccessible(auth, id);
    const updates = await this.db
      .select()
      .from(incidentUpdates)
      .where(eq(incidentUpdates.incidentId, incident.id))
      .orderBy(asc(incidentUpdates.createdAt));

    return {
      ...toIncidentResponse(incident),
      updates: updates.map(toUpdateResponse),
    };
  }

  public async addUpdate(
    auth: AuthPrincipal,
    id: string,
    input: IncidentUpdateInput,
  ): Promise<IncidentUpdateResponse> {
    const incident = await this.findAccessible(auth, id);
    assertTransition(incident.status, input.status);

    const actor = auth.kind === 'user' ? `user:${auth.userId}` : `api-key:${auth.apiKeyId}`;
    const now = new Date();

    const update = await this.db.transaction(async (tx) => {
      const updatedRows = await tx
        .update(incidents)
        .set({
          status: input.status,
          ...(input.status === 'resolved' ? { resolvedAt: now } : {}),
        })
        .where(and(eq(incidents.id, incident.id), eq(incidents.status, incident.status)))
        .returning();

      if (!updatedRows[0]) {
        throw new ConflictException('incident status changed while applying the update');
      }

      const inserted = await tx
        .insert(incidentUpdates)
        .values({
          incidentId: incident.id,
          status: input.status,
          message: input.message,
          actor,
        })
        .returning();

      const row = inserted[0];
      if (!row) {
        throw new Error('incident update insert returned no row');
      }
      return row;
    });

    await this.notifications.enqueueForUpdate(update);
    return toUpdateResponse(update);
  }

  private async findAccessible(auth: AuthPrincipal, id: string): Promise<IncidentRow> {
    const rows = await this.db.select().from(incidents).where(eq(incidents.id, id)).limit(1);
    const incident = rows[0];
    if (!incident) {
      throw new NotFoundException('incident not found');
    }

    const monitorRows = await this.db
      .select()
      .from(monitors)
      .where(eq(monitors.id, incident.monitorId))
      .limit(1);
    const monitor = monitorRows[0];
    if (!monitor) {
      throw new NotFoundException('incident not found');
    }

    if (auth.kind === 'apiKey' && auth.projectId !== monitor.projectId) {
      throw new ForbiddenException('API key is scoped to a different project');
    }
    if (auth.kind === 'user') {
      await this.projects.assertAccess(auth, monitor.projectId);
    }

    return incident;
  }
}
