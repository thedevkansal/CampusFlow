import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Rating, RideStatus } from '@prisma/client';
import { RatingRepository } from './rating.repository';
import { CreateRatingDto } from './dto/create-rating.dto';
import { DriversRepository } from '@modules/drivers/drivers.repository';
import { Role } from '@common/types';

export interface RatingData {
  id: string;
  rideId: string;
  reviewerId: string;
  revieweeId: string;
  score: number;
  comment: string | null;
  createdAt: Date;
}

@Injectable()
export class RatingService {
  constructor(
    private readonly repo: RatingRepository,
    private readonly driversRepo: DriversRepository,
  ) {}

  async createRating(
    callerId: string,
    callerRole: Role,
    dto: CreateRatingDto,
  ): Promise<RatingData> {
    const ride = await this.repo.getRideForRating(dto.rideId);

    if (!ride) throw new NotFoundException({ message: 'Ride not found', code: 'RIDE_NOT_FOUND' });

    if (ride.status !== RideStatus.COMPLETED) {
      throw new UnprocessableEntityException({
        message: 'Ride must be COMPLETED before rating',
        code: 'RIDE_NOT_COMPLETED',
      });
    }

    let reviewerId: string;
    let revieweeId: string;

    if (callerRole === Role.PASSENGER) {
      if (ride.passengerId !== callerId) {
        throw new ForbiddenException({ message: 'Not your ride', code: 'RIDE_NOT_OWNED' });
      }
      if (!ride.assignment) {
        throw new UnprocessableEntityException({ message: 'No driver assigned', code: 'NO_DRIVER' });
      }
      reviewerId = callerId;
      revieweeId = ride.assignment.driver.userId;
    } else if (callerRole === Role.DRIVER) {
      const driver = await this.driversRepo.findByUserId(callerId);
      if (!driver || !ride.assignment || ride.assignment.driverId !== driver.id) {
        throw new ForbiddenException({ message: 'Not your ride', code: 'RIDE_NOT_OWNED' });
      }
      reviewerId = callerId;
      revieweeId = ride.passengerId;
    } else {
      throw new ForbiddenException({ message: 'Admins cannot create ratings', code: 'FORBIDDEN' });
    }

    const duplicate = await this.repo.existsByRideAndReviewer(dto.rideId, reviewerId);
    if (duplicate) {
      throw new ConflictException({ message: 'You have already rated this ride', code: 'RATING_DUPLICATE' });
    }

    const rating = await this.repo.create({
      rideId: dto.rideId,
      reviewerId,
      revieweeId,
      score: dto.score,
      comment: dto.comment,
    });

    // Update aggregates (non-blocking — errors don't fail the request)
    await Promise.all([
      this.repo.updateUserAggregates(revieweeId),
      this.repo.syncDriverRating(revieweeId),
    ]);

    return this.toDto(rating);
  }

  async getRatingsForRide(rideId: string): Promise<RatingData[]> {
    const rows = await this.repo.findByRideId(rideId);
    return rows.map(this.toDto);
  }

  async getRatingsReceived(userId: string): Promise<RatingData[]> {
    const rows = await this.repo.findByRevieweeId(userId);
    return rows.map(this.toDto);
  }

  async getRatingsGiven(userId: string): Promise<RatingData[]> {
    const rows = await this.repo.findByReviewerId(userId);
    return rows.map(this.toDto);
  }

  private toDto(r: Rating): RatingData {
    return {
      id: r.id,
      rideId: r.rideId,
      reviewerId: r.reviewerId,
      revieweeId: r.revieweeId,
      score: r.score,
      comment: r.comment,
      createdAt: r.createdAt,
    };
  }
}
