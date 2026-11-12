import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import type {
  CreateProjectInput,
  ProjectResponse,
  UpdateProjectInput,
} from '@statusbeam/contracts';
import type { AuthPrincipal } from '../../common/auth-principal';
import { DATABASE } from '../../db/database.module';
import type { Database } from '../../db/client';
import { projects } from '../../db/schema';
import type { Project } from '../../db/schema';

export function slugifyProjectName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'project';
}

export function toProjectResponse(project: Project): ProjectResponse {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    public: project.public,
    createdAt: project.createdAt.toISOString(),
  };
}

@Injectable()
export class ProjectsService {
  public constructor(@Inject(DATABASE) private readonly db: Database) {}

  public async create(userId: string, input: CreateProjectInput): Promise<ProjectResponse> {
    const slug = await this.uniqueSlug(slugifyProjectName(input.name));
    const rows = await this.db
      .insert(projects)
      .values({ userId, name: input.name, slug, public: input.public })
      .returning();
    const project = rows[0];
    if (!project) {
      throw new Error('project insert returned no row');
    }
    return toProjectResponse(project);
  }

  public async list(userId: string): Promise<ProjectResponse[]> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(projects.createdAt);
    return rows.map(toProjectResponse);
  }

  public async getOwned(userId: string, projectId: string): Promise<ProjectResponse> {
    const project = await this.findOwned(userId, projectId);
    return toProjectResponse(project);
  }

  public async update(
    userId: string,
    projectId: string,
    input: UpdateProjectInput,
  ): Promise<ProjectResponse> {
    const project = await this.findOwned(userId, projectId);

    if (input.slug !== undefined && input.slug !== project.slug) {
      if (project.public) {
        throw new BadRequestException('slug cannot change after the project is public');
      }
      const slug = await this.uniqueSlug(input.slug, project.id);
      project.slug = slug;
    }

    if (input.name !== undefined) {
      project.name = input.name;
    }
    if (input.public !== undefined) {
      project.public = input.public;
    }

    const rows = await this.db
      .update(projects)
      .set({ name: project.name, slug: project.slug, public: project.public })
      .where(eq(projects.id, project.id))
      .returning();
    const updated = rows[0];
    if (!updated) {
      throw new NotFoundException('project not found');
    }
    return toProjectResponse(updated);
  }

  /**
   * Single authorization choke point for project-scoped resources. JWT users must own the
   * project; API keys may only touch the project they were issued for.
   */
  public async assertAccess(auth: AuthPrincipal, projectId: string): Promise<Project> {
    if (auth.kind === 'apiKey') {
      if (auth.projectId !== projectId) {
        throw new ForbiddenException('API key is scoped to a different project');
      }
      const rows = await this.db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
      const project = rows[0];
      if (!project) {
        throw new NotFoundException('project not found');
      }
      return project;
    }

    return this.findOwned(auth.userId, projectId);
  }

  private async findOwned(userId: string, projectId: string): Promise<Project> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1);
    const project = rows[0];
    if (!project) {
      throw new NotFoundException('project not found');
    }
    return project;
  }

  private async uniqueSlug(base: string, excludeId?: string): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
      const candidate = `${base.slice(0, 48 - suffix.length)}${suffix}`;
      const rows = await this.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.slug, candidate))
        .limit(1);
      const existing = rows[0];
      if (!existing || existing.id === excludeId) {
        return candidate;
      }
    }
    throw new ConflictException('could not allocate a unique slug');
  }
}
