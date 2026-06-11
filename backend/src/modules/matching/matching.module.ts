/**
 * MatchingModule — BullMQ worker for driver matching.
 *
 * Co-located in the NestJS monolith (see docs/MATCHING_ENGINE.md §Architecture Decision).
 * Consumes jobs from the ride-matching queue registered by QueueModule (@Global).
 *
 * Imports DriversModule to access DriversRepository for candidate batch-fetch
 * and PostgreSQL status fallback.
 *
 * PrismaModule is @Global — PrismaService is injectable without explicit import.
 * RedisModule is @Global — RedisService is injectable without explicit import.
 * QueueModule is @Global — @InjectQueue tokens are injectable without re-registration.
 * AppConfigModule is @Global — AppConfigService is injectable without explicit import.
 */

import { Module } from '@nestjs/common';
import { DriversModule } from '@modules/drivers/drivers.module';
import { MatchingProcessor } from './matching.processor';
import { MatchingService } from './matching.service';
import { MatchingRepository } from './matching.repository';

@Module({
  imports: [DriversModule],
  providers: [MatchingProcessor, MatchingService, MatchingRepository],
})
export class MatchingModule {}
