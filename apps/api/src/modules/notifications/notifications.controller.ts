import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiAcceptedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { notificationFailureListResponseSchema } from '@statusbeam/contracts';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { CurrentAuth } from '../../common/auth-principal';
import type { AuthPrincipal } from '../../common/auth-principal';
import { responseSchema } from '../../common/openapi-schema';
import { NotificationsService } from './notifications.service';

const failureListResponse = responseSchema(notificationFailureListResponseSchema);
const replayResponse = responseSchema(z.object({ jobId: z.string() }));

@ApiTags('notifications')
@UseGuards(AuthorizationGuard)
@Controller('v1/notifications')
export class NotificationsController {
  public constructor(private readonly notifications: NotificationsService) {}

  @Get('dlq')
  @ApiOkResponse({ schema: failureListResponse })
  public async list(
    @CurrentAuth() auth: AuthPrincipal,
  ): Promise<z.infer<typeof notificationFailureListResponseSchema>> {
    if (auth.kind !== 'user') {
      throw new ForbiddenException('notification administration requires a user token');
    }
    return this.notifications.listFailures(auth.userId);
  }

  @Post('dlq/:id/replay')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ schema: replayResponse })
  public async replay(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ jobId: string }> {
    if (auth.kind !== 'user') {
      throw new ForbiddenException('notification administration requires a user token');
    }
    return this.notifications.replay(auth.userId, id);
  }
}
