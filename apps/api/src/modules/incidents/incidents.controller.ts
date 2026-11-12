import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import {
  incidentDetailResponseSchema,
  incidentListResponseSchema,
  incidentUpdateInputSchema,
  incidentUpdateResponseSchema,
} from '@statusbeam/contracts';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { AllowApiKey, CurrentAuth, RequireScopes } from '../../common/auth-principal';
import type { AuthPrincipal } from '../../common/auth-principal';
import { requestSchema, responseSchema } from '../../common/openapi-schema';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { IncidentsService } from './incidents.service';

const updateBody = requestSchema(incidentUpdateInputSchema);
const updateResponse = responseSchema(incidentUpdateResponseSchema);
const detailResponse = responseSchema(incidentDetailResponseSchema);
const listResponse = responseSchema(incidentListResponseSchema);

@ApiTags('incidents')
@AllowApiKey()
@UseGuards(AuthorizationGuard)
@Controller()
export class IncidentsController {
  public constructor(private readonly incidents: IncidentsService) {}

  @Get('v1/projects/:projectId/incidents')
  @RequireScopes('incidents:write')
  @ApiOkResponse({ schema: listResponse })
  public async list(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<z.infer<typeof incidentListResponseSchema>> {
    return this.incidents.listForProject(auth, projectId);
  }

  @Get('v1/incidents/:id')
  @RequireScopes('incidents:write')
  @ApiOkResponse({ schema: detailResponse })
  public async get(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<z.infer<typeof incidentDetailResponseSchema>> {
    return this.incidents.get(auth, id);
  }

  @Post('v1/incidents/:id/updates')
  @RequireScopes('incidents:write')
  @ApiBody({ schema: updateBody })
  @ApiCreatedResponse({ schema: updateResponse })
  public async addUpdate(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(incidentUpdateInputSchema))
    input: z.infer<typeof incidentUpdateInputSchema>,
  ): Promise<z.infer<typeof incidentUpdateResponseSchema>> {
    return this.incidents.addUpdate(auth, id, input);
  }
}
