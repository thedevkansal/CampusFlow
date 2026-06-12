import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthenticatedUser, ApiSuccessResponse } from '@common/types';
import { RatingService, RatingData } from './rating.service';
import { CreateRatingDto } from './dto/create-rating.dto';

@Controller('ratings')
@UseGuards(JwtAuthGuard)
export class RatingsController {
  constructor(private readonly ratingService: RatingService) {}

  /** POST /ratings — rate a completed ride (PASSENGER or DRIVER) */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createRating(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRatingDto,
  ): Promise<ApiSuccessResponse<RatingData>> {
    const data = await this.ratingService.createRating(user.id, user.role, dto);
    return { success: true, data, message: 'Rating submitted successfully' };
  }

  /** GET /ratings/ride/:rideId — all ratings for a ride */
  @Get('ride/:rideId')
  @HttpCode(HttpStatus.OK)
  async getRatingsForRide(
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ): Promise<ApiSuccessResponse<RatingData[]>> {
    const data = await this.ratingService.getRatingsForRide(rideId);
    return { success: true, data, message: 'Ratings retrieved' };
  }

  /** GET /ratings/received — ratings received by the authenticated user */
  @Get('received')
  @HttpCode(HttpStatus.OK)
  async received(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiSuccessResponse<RatingData[]>> {
    const data = await this.ratingService.getRatingsReceived(user.id);
    return { success: true, data, message: 'Ratings retrieved' };
  }

  /** GET /ratings/given — ratings given by the authenticated user */
  @Get('given')
  @HttpCode(HttpStatus.OK)
  async given(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiSuccessResponse<RatingData[]>> {
    const data = await this.ratingService.getRatingsGiven(user.id);
    return { success: true, data, message: 'Ratings retrieved' };
  }
}
