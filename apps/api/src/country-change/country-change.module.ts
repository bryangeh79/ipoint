import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CountryChangeController } from './country-change.controller.js';
import { CountryChangeService } from './country-change.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [CountryChangeController],
  providers: [CountryChangeService],
})
export class CountryChangeModule {}
