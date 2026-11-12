import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectsModule } from '../projects/projects.module';
import { IncidentEvaluator } from './evaluator.service';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';

@Module({
  imports: [ProjectsModule, NotificationsModule],
  controllers: [IncidentsController],
  providers: [IncidentsService, IncidentEvaluator],
  exports: [IncidentEvaluator],
})
export class IncidentsModule {}
