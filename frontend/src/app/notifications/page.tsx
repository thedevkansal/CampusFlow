'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Check,
  Car,
  Navigation,
  ShieldCheck,
  Loader2,
  CheckCheck,
} from 'lucide-react';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/layout/navbar';
import { api } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { cn } from '@/lib/utils';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const { isLoading: authLoading } = useRequireAuth();

  // GET /notifications → { success, data: { data: Notification[], total: number } }
  // res.data.data = { data: Notification[], total: number }
  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const res = await api.get('/notifications');
      return res.data.data; // { data: Notification[], total: number }
    },
    enabled: !authLoading,
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await api.patch('/notifications/read-all');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const getIcon = (type: string) => {
    switch (type) {
      case 'RIDE_ASSIGNED':
        return <Car className="h-4 w-4 text-amber-500" />;
      case 'RIDE_ACCEPTED':
        return <Navigation className="h-4 w-4 text-primary" />;
      case 'RIDE_COMPLETED':
        return <ShieldCheck className="h-4 w-4 text-emerald-500" />;
      default:
        return <Bell className="h-4 w-4 text-muted-foreground" />;
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </main>
      </div>
    );
  }

  // data = { data: Notification[], total: number }
  const notifications: Notification[] = data?.data ?? [];
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />

      <main className="flex-1 container mx-auto px-4 py-8 max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
            {unreadCount > 0 && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {unreadCount} unread
              </p>
            )}
          </div>
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
            >
              {markAllReadMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCheck className="h-3.5 w-3.5" />
              )}
              Mark all read
            </Button>
          )}
        </div>

        <div className="space-y-2">
          {notifications.length === 0 ? (
            <Card className="shadow-sm">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                <div className="bg-muted/50 p-4 rounded-full mb-4">
                  <Bell className="h-8 w-8 text-muted-foreground/50" />
                </div>
                <p className="font-medium">No notifications yet</p>
                <p className="text-sm mt-1">You&apos;ll see ride updates here</p>
              </CardContent>
            </Card>
          ) : (
            notifications.map((notification) => (
              <div
                key={notification.id}
                className={cn(
                  'flex gap-3 p-4 rounded-xl border transition-colors',
                  notification.isRead
                    ? 'bg-background border-border'
                    : 'bg-primary/5 border-primary/20'
                )}
              >
                {/* Icon */}
                <div className="mt-0.5 bg-background border border-border p-2 rounded-lg h-fit shadow-sm">
                  {getIcon(notification.type)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h4
                      className={cn(
                        'text-sm font-semibold leading-tight',
                        notification.isRead ? 'text-foreground/80' : 'text-foreground'
                      )}
                    >
                      {notification.title}
                    </h4>
                    <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                      {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  <p
                    className={cn(
                      'text-sm mt-0.5',
                      notification.isRead ? 'text-muted-foreground' : 'text-foreground/80'
                    )}
                  >
                    {notification.body}
                  </p>
                </div>

                {/* Mark read button */}
                {!notification.isRead && (
                  <button
                    onClick={() => markReadMutation.mutate(notification.id)}
                    disabled={markReadMutation.isPending}
                    className="mt-0.5 shrink-0 h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                    title="Mark as read"
                  >
                    {markReadMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
