import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { JobService } from './job.service.js';
import { JobSchedulerService } from './job-scheduler.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  providers: [JobService, JobSchedulerService],
  exports: [JobService, JobSchedulerService],
})
export class DailyJobModule {}
