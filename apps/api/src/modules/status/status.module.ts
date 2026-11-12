import { Global, Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { StatusController } from './status.controller';
import { StatusEventsService } from './status-events.service';
import { StatusService } from './status.service';

@Global()
@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])],
  controllers: [StatusController],
  providers: [StatusService, StatusEventsService],
  exports: [StatusService, StatusEventsService],
})
export class StatusModule {}
