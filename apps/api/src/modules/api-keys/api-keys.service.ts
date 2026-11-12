import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import type { ApiKeyResponse, ApiScope, CreateApiKeyInput } from '@statusbeam/contracts';
import { API_SCOPES } from '@statusbeam/contracts';
import type { AuthPrincipal } from '../../common/auth-principal';
import { DATABASE } from '../../db/database.module';
import type { Database } from '../../db/client';
import { apiKeys } from '../../db/schema';
import type { ApiKey } from '../../db/schema';
import { ProjectsService } from '../projects/projects.service';
import { generateApiKey } from './api-key.crypto';

function toApiKeyResponse(record: ApiKey, key?: string): ApiKeyResponse {
  return {
    id: record.id,
    projectId: record.projectId,
    name: record.name,
    prefix: record.prefix,
    scopes: record.scopes.filter((scope): scope is ApiScope =>
      (API_SCOPES as readonly string[]).includes(scope),
    ),
    lastUsedAt: record.lastUsedAt ? record.lastUsedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
    ...(key ? { key } : {}),
  };
}

@Injectable()
export class ApiKeysService {
  public constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
  ) {}

  public async create(auth: AuthPrincipal, input: CreateApiKeyInput): Promise<ApiKeyResponse> {
    if (auth.kind !== 'user') {
      throw new NotFoundException('project not found');
    }
    await this.projects.assertAccess(auth, input.projectId);

    const scopes = [...new Set(input.scopes)];
    const generated = generateApiKey();
    const rows = await this.db
      .insert(apiKeys)
      .values({
        projectId: input.projectId,
        name: input.name,
        scopes,
        keyHash: generated.hash,
        prefix: generated.prefix,
      })
      .returning();
    const record = rows[0];
    if (!record) {
      throw new Error('api key insert returned no row');
    }

    return toApiKeyResponse(record, generated.key);
  }

  public async list(auth: AuthPrincipal, projectId: string): Promise<ApiKeyResponse[]> {
    await this.projects.assertAccess(auth, projectId);
    const rows = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.projectId, projectId), isNull(apiKeys.revokedAt)))
      .orderBy(apiKeys.createdAt);
    return rows.map((row) => toApiKeyResponse(row));
  }

  public async revoke(auth: AuthPrincipal, id: string): Promise<void> {
    const rows = await this.db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
    const record = rows[0];
    if (!record || record.revokedAt) {
      throw new NotFoundException('api key not found');
    }
    await this.projects.assertAccess(auth, record.projectId);
    await this.db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
  }
}
