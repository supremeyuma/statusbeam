import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { requestSchema, responseSchema } from '../../common/openapi-schema';

import {
  createProjectInputSchema,
  projectListResponseSchema,
  projectResponseSchema,
  updateProjectInputSchema,
} from '@statusbeam/contracts';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { CurrentAuth } from '../../common/auth-principal';
import type { AuthPrincipal } from '../../common/auth-principal';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ProjectsService } from './projects.service';

const createBody = requestSchema(createProjectInputSchema);
const updateBody = requestSchema(updateProjectInputSchema);
const projectResponse = responseSchema(projectResponseSchema);
const projectListResponse = responseSchema(projectListResponseSchema);

@ApiTags('projects')
@UseGuards(AuthorizationGuard)
@Controller('v1/projects')
export class ProjectsController {
  public constructor(private readonly projects: ProjectsService) {}

  @Post()
  @ApiBody({ schema: createBody })
  @ApiCreatedResponse({ schema: projectResponse })
  public async create(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(new ZodValidationPipe(createProjectInputSchema))
    input: z.infer<typeof createProjectInputSchema>,
  ): Promise<z.infer<typeof projectResponseSchema>> {
    if (auth.kind !== 'user') {
      throw new ForbiddenException('projects can only be created with a user token');
    }
    return this.projects.create(auth.userId, input);
  }

  @Get()
  @ApiOkResponse({ schema: projectListResponse })
  public async list(
    @CurrentAuth() auth: AuthPrincipal,
  ): Promise<z.infer<typeof projectListResponseSchema>> {
    if (auth.kind !== 'user') {
      throw new ForbiddenException('projects can only be listed with a user token');
    }
    return this.projects.list(auth.userId);
  }

  @Get(':id')
  @ApiOkResponse({ schema: projectResponse })
  public async get(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<z.infer<typeof projectResponseSchema>> {
    if (auth.kind !== 'user') {
      throw new ForbiddenException('projects can only be read with a user token');
    }
    return this.projects.getOwned(auth.userId, id);
  }

  @Patch(':id')
  @ApiBody({ schema: updateBody })
  @ApiOkResponse({ schema: projectResponse })
  public async update(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateProjectInputSchema))
    input: z.infer<typeof updateProjectInputSchema>,
  ): Promise<z.infer<typeof projectResponseSchema>> {
    if (auth.kind !== 'user') {
      throw new ForbiddenException('projects can only be updated with a user token');
    }
    return this.projects.update(auth.userId, id, input);
  }
}
