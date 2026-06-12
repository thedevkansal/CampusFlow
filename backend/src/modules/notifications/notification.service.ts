import { Injectable, Logger } from '@nestjs/common';
import { Notification, NotificationType } from '@prisma/client';
import { NotificationRepository, CreateNotificationInput } from './notification.repository';
import { BaseGateway } from '@modules/gateway/base.gateway';
import { SocketNamespace } from '@common/types';

export interface NotificationData {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  payload: unknown;
  isRead: boolean;
  createdAt: Date;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly repo: NotificationRepository,
    private readonly baseGateway: BaseGateway,
  ) {}

  // ── Creation helpers called by RidesService / MatchingProcessor ──────────

  async createRideAssigned(passengerId: string, driverUserId: string, rideId: string): Promise<void> {
    await Promise.all([
      this.create({
        userId: passengerId,
        type: NotificationType.RIDE_ASSIGNED,
        title: 'Driver on the way!',
        body: 'A driver has been assigned to your ride.',
        payload: { rideId },
      }),
      this.create({
        userId: driverUserId,
        type: NotificationType.RIDE_ASSIGNED,
        title: 'New ride request',
        body: 'You have been assigned a new ride. Please accept within 15 seconds.',
        payload: { rideId },
      }),
    ]);
  }

  async createRideAccepted(passengerId: string, rideId: string): Promise<void> {
    await this.create({
      userId: passengerId,
      type: NotificationType.RIDE_ACCEPTED,
      title: 'Driver accepted your ride',
      body: 'Your driver has accepted the ride and is on the way.',
      payload: { rideId },
    });
  }

  async createRideCancelled(userId: string, rideId: string, cancelledBy: 'PASSENGER' | 'DRIVER'): Promise<void> {
    const isPassengerCancelling = cancelledBy === 'PASSENGER';
    await this.create({
      userId,
      type: NotificationType.RIDE_CANCELLED,
      title: 'Ride cancelled',
      body: isPassengerCancelling ? 'The passenger has cancelled the ride.' : 'Your driver has cancelled the ride.',
      payload: { rideId, cancelledBy },
    });
  }

  async createRideCompleted(passengerId: string, driverUserId: string, rideId: string): Promise<void> {
    await Promise.all([
      this.create({
        userId: passengerId,
        type: NotificationType.RIDE_COMPLETED,
        title: 'Ride completed',
        body: 'Your ride has been completed. Thank you for riding with CampusFlow!',
        payload: { rideId },
      }),
      this.create({
        userId: driverUserId,
        type: NotificationType.RIDE_COMPLETED,
        title: 'Ride completed',
        body: 'Ride completed successfully. Great job!',
        payload: { rideId },
      }),
    ]);
  }

  // ── Query methods used by NotificationsController ────────────────────────

  async list(userId: string, limit: number, offset: number): Promise<{ data: NotificationData[]; total: number }> {
    const [data, total] = await Promise.all([
      this.repo.findByUserId(userId, limit, offset),
      this.repo.countByUserId(userId),
    ]);
    return { data: data.map(this.toDto), total };
  }

  async unread(userId: string): Promise<NotificationData[]> {
    const rows = await this.repo.findUnreadByUserId(userId);
    return rows.map(this.toDto);
  }

  async markRead(id: string, userId: string): Promise<NotificationData | null> {
    const row = await this.repo.markRead(id, userId);
    return row ? this.toDto(row) : null;
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const updated = await this.repo.markAllRead(userId);
    return { updated };
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private async create(input: CreateNotificationInput): Promise<void> {
    try {
      const notification = await this.repo.create(input);
      this.emitToUser(input.userId, notification);
    } catch (err) {
      this.logger.error(`Failed to create notification: userId=${input.userId} type=${input.type}`, err);
    }
  }

  private emitToUser(userId: string, notification: Notification): void {
    const payload = {
      notificationId: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.body,
      createdAt: notification.createdAt,
    };
    // Emit to both namespaces — only the connected socket will receive it
    this.baseGateway.server.of(SocketNamespace.PASSENGER).to(`user:${userId}`).emit('notification_created', payload);
    this.baseGateway.server.of(SocketNamespace.DRIVER).to(`user:${userId}`).emit('notification_created', payload);
  }

  private toDto(n: Notification): NotificationData {
    return {
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      payload: n.payload,
      isRead: n.isRead,
      createdAt: n.createdAt,
    };
  }
}
