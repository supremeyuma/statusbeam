import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';

import type {
  ChannelResponse,
  CreateChannelInput,
  UpdateChannelInput,
} from '@statusbeam/contracts';
import {
  emailChannelConfigSchema,
  slackChannelConfigSchema,
  webhookChannelConfigSchema,
} from '@statusbeam/contracts';
import type { AuthPrincipal } from '../../common/auth-principal';
import { formatZodIssues } from '../../common/zod-validation.pipe';
import { DATABASE } from '../../db/database.module';
import type { Database } from '../../db/client';
import { channels } from '../../db/schema';
import type { Channel } from '../../db/schema';
import { ProjectsService } from '../projects/projects.service';

function maskConfig(
  type: Channel['type'],
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (type === 'webhook') {
    const { secret, ...rest } = config;
    void secret;
    return rest;
  }
  if (type === 'slack') {
    return { webhookUrl: '[redacted]' };
  }
  return config;
}

function toChannelResponse(channel: Channel): ChannelResponse {
  return {
    id: channel.id,
    projectId: channel.projectId,
    type: channel.type,
    config: maskConfig(channel.type, channel.config),
    active: channel.active,
    createdAt: channel.createdAt.toISOString(),
  };
}

function validateConfigForType(type: Channel['type'], config: unknown): Record<string, unknown> {
  const schema =
    type === 'webhook'
      ? webhookChannelConfigSchema
      : type === 'slack'
        ? slackChannelConfigSchema
        : emailChannelConfigSchema;
  const result = schema.safeParse(config);
  if (!result.success) {
    throw new BadRequestException(formatZodIssues(result.error));
  }
  return result.data;
}

@Injectable()
export class ChannelsService {
  public constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
  ) {}

  public async create(auth: AuthPrincipal, input: CreateChannelInput): Promise<ChannelResponse> {
    await this.projects.assertAccess(auth, input.projectId);
    const rows = await this.db
      .insert(channels)
      .values({
        projectId: input.projectId,
        type: input.type,
        config: input.config as Record<string, unknown>,
        active: input.active,
      })
      .returning();
    const channel = rows[0];
    if (!channel) {
      throw new Error('channel insert returned no row');
    }
    return toChannelResponse(channel);
  }

  public async list(auth: AuthPrincipal, projectId: string): Promise<ChannelResponse[]> {
    await this.projects.assertAccess(auth, projectId);
    const rows = await this.db
      .select()
      .from(channels)
      .where(eq(channels.projectId, projectId))
      .orderBy(desc(channels.createdAt));
    return rows.map(toChannelResponse);
  }

  public async update(
    auth: AuthPrincipal,
    id: string,
    input: UpdateChannelInput,
  ): Promise<ChannelResponse> {
    const channel = await this.findAccessible(auth, id);
    const config =
      input.config !== undefined ? validateConfigForType(channel.type, input.config) : undefined;

    const rows = await this.db
      .update(channels)
      .set({
        ...(config ? { config } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      })
      .where(eq(channels.id, id))
      .returning();
    const updated = rows[0];
    if (!updated) {
      throw new NotFoundException('channel not found');
    }
    return toChannelResponse(updated);
  }

  public async remove(auth: AuthPrincipal, id: string): Promise<void> {
    await this.findAccessible(auth, id);
    await this.db.delete(channels).where(eq(channels.id, id));
  }

  private async findAccessible(auth: AuthPrincipal, id: string): Promise<Channel> {
    const rows = await this.db.select().from(channels).where(eq(channels.id, id)).limit(1);
    const channel = rows[0];
    if (!channel) {
      throw new NotFoundException('channel not found');
    }
    await this.projects.assertAccess(auth, channel.projectId);
    return channel;
  }
}
