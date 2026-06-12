import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthenticatedUser, ApiSuccessResponse } from '@common/types';
import { NotificationService, NotificationData } from './notification.service';
import { QueryNotificationsDto } from './dto/query-notifications.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  /** GET /notifications?limit=20&offset=0 */
  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryNotificationsDto,
  ): Promise<ApiSuccessResponse<{ data: NotificationData[]; total: number }>> {
    const result = await this.notificationService.list(user.id, query.limit, query.offset);
    return { success: true, data: result, message: 'Notifications retrieved' };
  }

  /** GET /notifications/unread */
  @Get('unread')
  @HttpCode(HttpStatus.OK)
  async unread(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiSuccessResponse<NotificationData[]>> {
    const data = await this.notificationService.unread(user.id);
    return { success: true, data, message: 'Unread notifications retrieved' };
  }

  /** PATCH /notifications/:id/read */
  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiSuccessResponse<NotificationData>> {
    const data = await this.notificationService.markRead(id, user.id);
    if (!data) throw new NotFoundException({ message: 'Notification not found', code: 'NOTIFICATION_NOT_FOUND' });
    return { success: true, data, message: 'Notification marked as read' };
  }

  /** PATCH /notifications/read-all */
  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllRead(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiSuccessResponse<{ updated: number }>> {
    const data = await this.notificationService.markAllRead(user.id);
    return { success: true, data, message: 'All notifications marked as read' };
  }
}
