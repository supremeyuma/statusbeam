import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { requestSchema, responseSchema } from '../../common/openapi-schema';

import {
  apiKeyListResponseSchema,
  apiKeyResponseSchema,
  createApiKeyInputSchema,
} from '@statusbeam/contracts';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { CurrentAuth } from '../../common/auth-principal';
import type { AuthPrincipal } from '../../common/auth-principal';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ApiKeysService } from './api-keys.service';

const createBody = requestSchema(createApiKeyInputSchema);
const apiKeyResponse = responseSchema(apiKeyResponseSchema);
const apiKeyListResponse = responseSchema(apiKeyListResponseSchema);
const listQuerySchema = z.object({ projectId: z.uuid() });

@ApiTags('api-keys')
@UseGuards(AuthorizationGuard)
@Controller('v1/api-keys')
export class ApiKeysController {
  public constructor(private readonly apiKeys: ApiKeysService) {}

  @Post()
  @ApiBody({ schema: createBody })
  @ApiCreatedResponse({ schema: apiKeyResponse })
  public async create(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(new ZodValidationPipe(createApiKeyInputSchema))
    input: z.infer<typeof createApiKeyInputSchema>,
  ): Promise<z.infer<typeof apiKeyResponseSchema>> {
    return this.apiKeys.create(auth, input);
  }

  @Get()
  @ApiQuery({ name: 'projectId', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ schema: apiKeyListResponse })
  public async list(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ): Promise<z.infer<typeof apiKeyListResponseSchema>> {
    return this.apiKeys.list(auth, query.projectId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async revoke(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.apiKeys.revoke(auth, id);
  }
}
