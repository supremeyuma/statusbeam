import { Module } from '@nestjs/common';

import { JobsModule } from '../../jobs/jobs.module';
import { ProjectsModule } from '../projects/projects.module';
import { MonitorsController } from './monitors.controller';
import { MonitorsService } from './monitors.service';

@Module({
  imports: [ProjectsModule, JobsModule],
  controllers: [MonitorsController],
  providers: [MonitorsService],
  exports: [MonitorsService],
})
export class MonitorsModule {}
