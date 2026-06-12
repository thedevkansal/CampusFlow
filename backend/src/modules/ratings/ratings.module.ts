import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';
import { DriversModule } from '@modules/drivers/drivers.module';
import { RatingRepository } from './rating.repository';
import { RatingService } from './rating.service';
import { RatingsController } from './ratings.controller';

@Module({
  imports: [AuthModule, DriversModule],
  providers: [RatingRepository, RatingService],
  controllers: [RatingsController],
})
export class RatingsModule {}
