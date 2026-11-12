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

import {
  channelListResponseSchema,
  channelResponseSchema,
  createChannelInputSchema,
  updateChannelInputSchema,
} from '@statusbeam/contracts';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { AllowApiKey, CurrentAuth, RequireScopes } from '../../common/auth-principal';
import type { AuthPrincipal } from '../../common/auth-principal';
import { requestSchema, responseSchema } from '../../common/openapi-schema';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ChannelsService } from './channels.service';

const createBody = requestSchema(createChannelInputSchema);
const updateBody = requestSchema(updateChannelInputSchema);
const channelResponse = responseSchema(channelResponseSchema);
const channelListResponse = responseSchema(channelListResponseSchema);
const listQuerySchema = z.object({ projectId: z.uuid() });

@ApiTags('channels')
@AllowApiKey()
@RequireScopes('incidents:write')
@UseGuards(AuthorizationGuard)
@Controller('v1/channels')
export class ChannelsController {
  public constructor(private readonly channels: ChannelsService) {}

  @Post()
  @ApiBody({ schema: createBody })
  @ApiCreatedResponse({ schema: channelResponse })
  public async create(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(new ZodValidationPipe(createChannelInputSchema))
    input: z.infer<typeof createChannelInputSchema>,
  ): Promise<z.infer<typeof channelResponseSchema>> {
    return this.channels.create(auth, input);
  }

  @Get()
  @ApiQuery({ name: 'projectId', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ schema: channelListResponse })
  public async list(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ): Promise<z.infer<typeof channelListResponseSchema>> {
    return this.channels.list(auth, query.projectId);
  }

  @Patch(':id')
  @ApiBody({ schema: updateBody })
  @ApiOkResponse({ schema: channelResponse })
  public async update(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateChannelInputSchema))
    input: z.infer<typeof updateChannelInputSchema>,
  ): Promise<z.infer<typeof channelResponseSchema>> {
    return this.channels.update(auth, id, input);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async remove(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.channels.remove(auth, id);
  }
}
