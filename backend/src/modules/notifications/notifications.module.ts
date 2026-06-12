import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';
import { GatewayModule } from '@modules/gateway/gateway.module';
import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';

@Module({
  imports: [
    AuthModule,    // JwtAuthGuard for controller
    GatewayModule, // BaseGateway for socket emission
  ],
  providers: [NotificationRepository, NotificationService],
  controllers: [NotificationsController],
  exports: [NotificationService],
})
export class NotificationsModule {}
