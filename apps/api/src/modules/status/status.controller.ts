import {
  Controller,
  Get,
  Headers,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { publicStatusResponseSchema } from '@statusbeam/contracts';
import { APP_CONFIG } from '../../common/config.module';
import type { AppConfig } from '../../common/config';
import { responseSchema } from '../../common/openapi-schema';
import { StatusEventsService } from './status-events.service';
import type { StatusEvent } from './status-events.service';
import { StatusService } from './status.service';

const statusResponse = responseSchema(publicStatusResponseSchema);
const MAX_BUFFERED_INCIDENTS = 1000;

function formatEvent(event: StatusEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
}

@ApiTags('public-status')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('v1/projects')
export class StatusController {
  private readonly logger = new Logger(StatusController.name);

  public constructor(
    private readonly status: StatusService,
    private readonly events: StatusEventsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get(':slug/status')
  @ApiOkResponse({ schema: statusResponse })
  public async getStatus(
    @Param('slug') slug: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const cached = await this.status.getPublicStatus(slug);
    if (!cached) {
      throw new NotFoundException('status page not found');
    }

    res.setHeader('Cache-Control', 'public, max-age=10');
    res.setHeader('ETag', cached.etag);

    if (ifNoneMatch && ifNoneMatch.split(',').some((value) => value.trim() === cached.etag)) {
      res.status(304).end();
      return;
    }

    res.type('application/json').status(200).send(cached.body);
  }

  @Get(':slug/stream')
  @ApiProduces('text/event-stream')
  public async stream(
    @Param('slug') slug: string,
    @Req() req: Request,
    @Res() res: Response,
    @Headers('last-event-id') lastEventId: string | undefined,
  ): Promise<void> {
    const project = await this.status.findPublicProjectBySlug(slug);
    if (!project) {
      throw new NotFoundException('status page not found');
    }

    const snapshot = await this.status.snapshotForSlug(slug);
    if (!snapshot) {
      throw new NotFoundException('status page not found');
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.flushHeaders();

    let closed = false;
    let paused = false;
    const buffered: StatusEvent[] = [];
    let subscriber: Awaited<ReturnType<StatusEventsService['subscribe']>> | null = null;

    const cleanup = (): void => {
      if (closed) {
        return;
      }
      closed = true;
      clearInterval(heartbeat);
      if (subscriber) {
        void subscriber.quit().catch(() => subscriber?.disconnect());
        subscriber = null;
      }
    };

    const endForSlowClient = (): void => {
      this.logger.warn(`SSE client for ${slug} could not keep up; closing for replay`);
      cleanup();
      if (!res.writableEnded) {
        res.end();
      }
    };

    // Subscribe before sending the snapshot so nothing published during connect is missed.
    subscriber = await this.events.subscribe(project.id, (event) => {
      if (closed) {
        return;
      }
      if (paused) {
        if (event.type === 'incident') {
          if (buffered.length >= MAX_BUFFERED_INCIDENTS) {
            endForSlowClient();
            return;
          }
          buffered.push(event);
        }
        return;
      }
      if (res.write(formatEvent(event)) === false) {
        paused = true;
      }
    });

    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);

    const history = await this.events.history(project.id, lastEventId);
    for (const event of history) {
      if (res.write(formatEvent(event)) === false) {
        paused = true;
        break;
      }
    }

    const heartbeat = setInterval(() => {
      if (!paused && !closed) {
        res.write(': ping\n\n');
      }
    }, this.config.sseHeartbeatMs);

    res.on('drain', () => {
      paused = false;
      while (buffered.length > 0 && !paused && !closed) {
        const next = buffered.shift();
        if (next && res.write(formatEvent(next)) === false) {
          paused = true;
        }
      }
    });
    res.on('close', cleanup);
    req.on('close', cleanup);
  }
}
