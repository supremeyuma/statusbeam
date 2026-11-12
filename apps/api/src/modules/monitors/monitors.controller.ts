import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { requestSchema, responseSchema } from '../../common/openapi-schema';

import {
  checkListResponseSchema,
  monitorInputSchema,
  monitorListResponseSchema,
  monitorResponseSchema,
  monitorUpdateInputSchema,
} from '@statusbeam/contracts';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { AllowApiKey, CurrentAuth, RequireScopes } from '../../common/auth-principal';
import type { AuthPrincipal } from '../../common/auth-principal';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { MonitorsService } from './monitors.service';

const createBody = requestSchema(monitorInputSchema);
const updateBody = requestSchema(monitorUpdateInputSchema);
const monitorResponse = responseSchema(monitorResponseSchema);
const monitorListResponse = responseSchema(monitorListResponseSchema);
const checkListResponse = responseSchema(checkListResponseSchema);
const listQuerySchema = z.object({ projectId: z.uuid() });
const checksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(500).optional(),
});

@ApiTags('monitors')
@AllowApiKey()
@UseGuards(AuthorizationGuard)
@Controller('v1/monitors')
export class MonitorsController {
  public constructor(private readonly monitors: MonitorsService) {}

  @Post()
  @RequireScopes('monitors:write')
  @ApiBody({ schema: createBody })
  @ApiCreatedResponse({ schema: monitorResponse })
  public async create(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(new ZodValidationPipe(monitorInputSchema)) input: z.infer<typeof monitorInputSchema>,
  ): Promise<z.infer<typeof monitorResponseSchema>> {
    return this.monitors.create(auth, input);
  }

  @Get()
  @RequireScopes('monitors:read')
  @ApiQuery({ name: 'projectId', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ schema: monitorListResponse })
  public async list(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ): Promise<z.infer<typeof monitorListResponseSchema>> {
    return this.monitors.list(auth, query.projectId);
  }

  @Get(':id/checks')
  @RequireScopes('monitors:read')
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 200 },
  })
  @ApiQuery({ name: 'cursor', required: false, schema: { type: 'string' } })
  @ApiOkResponse({ schema: checkListResponse })
  public async listChecks(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(checksQuerySchema)) query: z.infer<typeof checksQuerySchema>,
  ): Promise<z.infer<typeof checkListResponseSchema>> {
    return this.monitors.listChecks(auth, id, query.limit, query.cursor);
  }

  @Get(':id')
  @RequireScopes('monitors:read')
  @ApiOkResponse({ schema: monitorResponse })
  public async get(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<z.infer<typeof monitorResponseSchema>> {
    return this.monitors.get(auth, id);
  }

  @Patch(':id')
  @RequireScopes('monitors:write')
  @ApiBody({ schema: updateBody })
  @ApiOkResponse({ schema: monitorResponse })
  public async update(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(monitorUpdateInputSchema))
    input: z.infer<typeof monitorUpdateInputSchema>,
  ): Promise<z.infer<typeof monitorResponseSchema>> {
    return this.monitors.update(auth, id, input);
  }

  @Delete(':id')
  @RequireScopes('monitors:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async remove(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.monitors.remove(auth, id);
  }
}
