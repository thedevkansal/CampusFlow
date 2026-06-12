import { Injectable } from '@nestjs/common';
import { Notification, NotificationType } from '@prisma/client';
import { PrismaService } from '@prisma/prisma.service';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}

@Injectable()
export class NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateNotificationInput): Promise<Notification> {
    return this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        payload: (input.payload ?? undefined) as object | undefined,
      },
    });
  }

  async findByUserId(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async findUnreadByUserId(userId: string): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { userId, isRead: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  async countByUserId(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId } });
  }

  async markRead(id: string, userId: string): Promise<Notification | null> {
    return this.prisma.notification.update({
      where: { id, userId },
      data: { isRead: true },
    }).catch(() => null);
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return result.count;
  }
}
