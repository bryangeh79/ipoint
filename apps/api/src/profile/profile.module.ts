import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MemberSelfController } from './member-self.controller.js';
import { ProfileController } from './profile.controller.js';
import { ProfileService } from './profile.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [MemberSelfController, ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
