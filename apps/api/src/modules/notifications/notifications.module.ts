import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

import { APP_CONFIG } from '../../common/config.module';
import type { AppConfig } from '../../common/config';
import { ProjectsModule } from '../projects/projects.module';
import { EmailAdapter } from './adapters/email.adapter';
import { SlackAdapter } from './adapters/slack.adapter';
import { WebhookAdapter } from './adapters/webhook.adapter';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { NotificationProcessor } from './notification.processor';
import {
  NOTIFICATIONS_QUEUE,
  NOTIFICATIONS_QUEUE_NAME,
  NOTIFICATION_DLQ,
  NOTIFICATION_DLQ_NAME,
} from './notifications.tokens';
import { NotificationsController } from './notifications.controller';
import { NotificationsRuntimeService } from './notifications-runtime.service';
import { NotificationsService } from './notifications.service';

function queueFactory(config: AppConfig, name: string): Queue | null {
  if (!config.jobsEnabled) {
    return null;
  }
  return new Queue(name, {
    connection: new Redis(config.redisUrl, { maxRetriesPerRequest: null }),
  });
}

@Module({
  imports: [ProjectsModule],
  controllers: [ChannelsController, NotificationsController],
  providers: [
    {
      provide: NOTIFICATIONS_QUEUE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => queueFactory(config, NOTIFICATIONS_QUEUE_NAME),
    },
    {
      provide: NOTIFICATION_DLQ,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => queueFactory(config, NOTIFICATION_DLQ_NAME),
    },
    WebhookAdapter,
    SlackAdapter,
    EmailAdapter,
    NotificationProcessor,
    NotificationsService,
    NotificationsRuntimeService,
    ChannelsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
