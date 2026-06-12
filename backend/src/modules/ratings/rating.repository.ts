import { Injectable } from '@nestjs/common';
import { Rating } from '@prisma/client';
import { PrismaService } from '@prisma/prisma.service';

export interface CreateRatingInput {
  rideId: string;
  reviewerId: string;
  revieweeId: string;
  score: number;
  comment?: string;
}

@Injectable()
export class RatingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateRatingInput): Promise<Rating> {
    return this.prisma.rating.create({ data: input });
  }

  async findByRideId(rideId: string): Promise<Rating[]> {
    return this.prisma.rating.findMany({
      where: { rideId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByRevieweeId(revieweeId: string): Promise<Rating[]> {
    return this.prisma.rating.findMany({
      where: { revieweeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByReviewerId(reviewerId: string): Promise<Rating[]> {
    return this.prisma.rating.findMany({
      where: { reviewerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async existsByRideAndReviewer(rideId: string, reviewerId: string): Promise<boolean> {
    const count = await this.prisma.rating.count({ where: { rideId, reviewerId } });
    return count > 0;
  }

  /** Recalculate and persist averageRating + totalRatings for a User. */
  async updateUserAggregates(userId: string): Promise<void> {
    const agg = await this.prisma.rating.aggregate({
      where: { revieweeId: userId },
      _avg: { score: true },
      _count: { score: true },
    });
    const avg = agg._avg.score ?? 5.0;
    const total = agg._count.score;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        averageRating: parseFloat(avg.toFixed(2)),
        totalRatings: total,
      },
    });
  }

  /** Also sync Driver.rating / totalRatings if the reviewee is a driver. */
  async syncDriverRating(userId: string): Promise<void> {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!driver) return;

    const agg = await this.prisma.rating.aggregate({
      where: { revieweeId: userId },
      _avg: { score: true },
      _count: { score: true },
    });
    const avg = agg._avg.score ?? 5.0;
    const total = agg._count.score;

    await this.prisma.driver.update({
      where: { id: driver.id },
      data: {
        rating: parseFloat(avg.toFixed(2)),
        totalRatings: total,
      },
    });
  }

  /** Fetch the completed ride with passenger + assignment for ownership checks. */
  async getRideForRating(rideId: string) {
    return this.prisma.ride.findUnique({
      where: { id: rideId },
      select: {
        id: true,
        status: true,
        passengerId: true,
        assignment: {
          select: {
            driverId: true,
            driver: { select: { userId: true } },
          },
        },
      },
    });
  }
}
