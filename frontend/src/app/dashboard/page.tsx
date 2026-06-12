'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MapPin,
  Navigation,
  Clock,
  CreditCard,
  Car,
  AlertCircle,
  Loader2,
  Info,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Navbar } from '@/components/layout/navbar';
import { Map } from '@/components/map';
import { api } from '@/lib/api';
import { useSocket } from '@/context/socket-context';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { cn } from '@/lib/utils';

const STATUS_LABELS: Record<string, string> = {
  REQUESTED: 'Finding your driver…',
  ASSIGNED: 'Driver assigned',
  ACCEPTED: 'Driver on the way',
  ARRIVING: 'Driver arriving',
  IN_PROGRESS: 'Ride in progress',
  COMPLETED: 'Ride completed',
  PASSENGER_CANCELLED: 'Cancelled',
  DRIVER_CANCELLED: 'Cancelled by driver',
  NO_DRIVER_FOUND: 'No driver found',
  TIMED_OUT: 'Timed out',
};

const STATUS_COLORS: Record<string, string> = {
  REQUESTED: 'bg-amber-100 text-amber-800',
  ASSIGNED: 'bg-blue-100 text-blue-800',
  ACCEPTED: 'bg-blue-100 text-blue-800',
  ARRIVING: 'bg-indigo-100 text-indigo-800',
  IN_PROGRESS: 'bg-primary/10 text-primary',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  PASSENGER_CANCELLED: 'bg-slate-100 text-slate-600',
  DRIVER_CANCELLED: 'bg-slate-100 text-slate-600',
  NO_DRIVER_FOUND: 'bg-red-100 text-red-700',
  TIMED_OUT: 'bg-slate-100 text-slate-600',
};

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const { passengerSocket } = useSocket();
  const [pickupAddr, setPickupAddr] = useState('Main Gate');
  const [destAddr, setDestAddr] = useState('Library');
  const [error, setError] = useState('');
  const [socketError, setSocketError] = useState('');

  const { isLoading: authLoading } = useRequireAuth('PASSENGER');

  // Fetch active ride — returns null on 404 to clear stale data after cancellation/completion
  const { data: activeRide, isLoading: rideLoading } = useQuery({
    queryKey: ['activeRide'],
    queryFn: async () => {
      try {
        const res = await api.get('/rides/active');
        return res.data.data ?? null;
      } catch (err: any) {
        if (err?.response?.status === 404) return null;
        throw err;
      }
    },
    enabled: !authLoading,
    retry: (count, err: any) => err?.response?.status !== 404 && count < 2,
  });

  // Attach event listeners to the shared socket from SocketProvider.
  // We do NOT connect/disconnect here — that is managed by SocketProvider
  // so the connection survives page navigation within the app.
  useEffect(() => {
    const socket = passengerSocket;
    if (!socket) return;

    const onConnectError = (err: Error) => setSocketError(`Connection error: ${err.message}`);
    const onConnect = () => {
      setSocketError('');
      socket.emit('session:restore', {
        lastEventTimestamp: new Date(Date.now() - 3600000).toISOString(),
      });
    };
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['activeRide'] });
    const onLocationUpdate = (data: any) => {
      queryClient.setQueryData(['activeRide'], (oldData: any) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          currentDriverLocation: {
            lat: data.latitude.toString(),
            lng: data.longitude.toString(),
            heading: data.heading?.toString(),
          },
        };
      });
    };

    socket.on('connect_error', onConnectError);
    socket.on('connect', onConnect);
    socket.on('ride_assigned', invalidate);
    socket.on('ride_accepted', invalidate);
    socket.on('ride_updated', invalidate);
    socket.on('ride_cancelled', invalidate);
    socket.on('ride_completed', invalidate);
    socket.on('driver:location_update', onLocationUpdate);

    // Emit session:restore if already connected
    if (socket.connected) {
      socket.emit('session:restore', {
        lastEventTimestamp: new Date(Date.now() - 3600000).toISOString(),
      });
    }

    // Remove only the listeners we added — do NOT disconnect the socket.
    return () => {
      socket.off('connect_error', onConnectError);
      socket.off('connect', onConnect);
      socket.off('ride_assigned', invalidate);
      socket.off('ride_accepted', invalidate);
      socket.off('ride_updated', invalidate);
      socket.off('ride_cancelled', invalidate);
      socket.off('ride_completed', invalidate);
      socket.off('driver:location_update', onLocationUpdate);
    };
  }, [passengerSocket, queryClient]);

  // Create Ride
  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        pickupLat: 12.9716,
        pickupLng: 77.5946,
        pickupAddress: pickupAddr,
        destLat: 12.978,
        destLng: 77.598,
        destAddress: destAddr,
      };
      const res = await api.post('/rides', payload);
      return res.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activeRide'] });
      setError('');
    },
    onError: (err: any) => {
      setError(err.response?.data?.message || 'Failed to request ride');
    },
  });

  // Cancel Ride
  const cancelMutation = useMutation({
    mutationFn: async (rideId: string) => {
      const res = await api.post(`/rides/${rideId}/cancel`, { reasonCode: 'CHANGED_MIND' });
      return res.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activeRide'] });
    },
    onError: (err: any) => {
      setError(err.response?.data?.message || 'Could not cancel ride');
    },
  });

  const handleRequestRide = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    createMutation.mutate();
  };

  const canCancel =
    activeRide &&
    !['IN_PROGRESS', 'COMPLETED', 'PASSENGER_CANCELLED', 'DRIVER_CANCELLED'].includes(
      activeRide.status
    );

  if (authLoading || rideLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm">Loading your dashboard…</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />

      <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {activeRide ? 'Track your current ride' : 'Request a ride across campus'}
          </p>
        </div>

        {/* Socket error banner */}
        {socketError && (
          <div className="mb-4 flex items-center gap-2 bg-amber-50 text-amber-800 text-sm px-4 py-3 rounded-lg border border-amber-200">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{socketError}</span>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6 items-start">
          {/* LEFT COLUMN */}
          <div className="space-y-4">
            {!activeRide ? (
              <Card className="shadow-sm">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg">Where to?</CardTitle>
                  <CardDescription>
                    Request a ride anywhere on campus
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleRequestRide} className="space-y-4">
                    {error && (
                      <div className="flex items-start gap-2 bg-destructive/10 text-destructive text-sm p-3 rounded-lg border border-destructive/20">
                        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                        <span>{error}</span>
                      </div>
                    )}

                    {/* Coordinates info banner */}
                    <div className="flex items-start gap-2 bg-muted/50 text-muted-foreground text-xs px-3 py-2 rounded-lg">
                      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>Demo coordinates used for pickup (12.9716°N, 77.5946°E) and destination.</span>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="pickup" className="text-sm font-medium">
                        Pickup location
                      </Label>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="pickup"
                          value={pickupAddr}
                          onChange={(e) => setPickupAddr(e.target.value)}
                          className="pl-9 h-10"
                          placeholder="Pickup location name"
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="destination" className="text-sm font-medium">
                        Destination
                      </Label>
                      <div className="relative">
                        <Navigation className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
                        <Input
                          id="destination"
                          value={destAddr}
                          onChange={(e) => setDestAddr(e.target.value)}
                          className="pl-9 h-10"
                          placeholder="Where are you going?"
                          required
                        />
                      </div>
                    </div>

                    <Button
                      type="submit"
                      className="w-full h-11 text-sm font-semibold mt-2"
                      disabled={createMutation.isPending}
                    >
                      {createMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Requesting…
                        </>
                      ) : (
                        'Request Ride'
                      )}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            ) : (
              <Card className="shadow-sm overflow-hidden">
                {/* Status bar */}
                <div
                  className={cn(
                    'px-5 py-3 flex items-center justify-between',
                    STATUS_COLORS[activeRide.status] ?? 'bg-muted'
                  )}
                >
                  <span className="text-sm font-semibold">
                    {STATUS_LABELS[activeRide.status] ?? activeRide.status.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs opacity-70 font-mono">#{activeRide.id.slice(-6).toUpperCase()}</span>
                </div>

                <CardContent className="p-5 space-y-5">
                  {/* Route timeline */}
                  <div className="relative pl-5 space-y-5 border-l-2 border-border ml-2">
                    <div className="relative">
                      <div className="absolute -left-[23px] top-1 bg-background border-2 border-border w-5 h-5 rounded-full flex items-center justify-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                      </div>
                      <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-0.5">
                        Pickup
                      </p>
                      <p className="font-medium text-foreground text-sm">{activeRide.pickup.address}</p>
                    </div>

                    <div className="relative">
                      <div className="absolute -left-[23px] top-1 bg-background border-2 border-primary/40 w-5 h-5 rounded-full flex items-center justify-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                      </div>
                      <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-0.5">
                        Destination
                      </p>
                      <p className="font-medium text-foreground text-sm">{activeRide.destination.address}</p>
                    </div>
                  </div>

                  {/* Driver info */}
                  {activeRide.driver && (
                    <div className="bg-muted/50 rounded-xl p-4 flex items-center gap-3">
                      <div className="h-11 w-11 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-base shrink-0">
                        {activeRide.driver.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground text-sm truncate">
                          {activeRide.driver.name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {[activeRide.driver.vehicleColor, activeRide.driver.vehicleModel]
                            .filter(Boolean)
                            .join(' ')}{' '}
                          <span className="font-mono">{activeRide.driver.vehicleNumber}</span>
                        </p>
                      </div>
                      <div className="text-sm font-semibold text-amber-600 shrink-0">
                        ⭐ {Number(activeRide.driver.rating).toFixed(1)}
                      </div>
                    </div>
                  )}

                  {/* Fare & distance */}
                  {activeRide.estimatedFare && (
                    <div className="flex items-center justify-between pt-3 border-t border-border">
                      <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        <Clock className="h-4 w-4" />
                        <span>{activeRide.estimatedDistanceKm} km</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CreditCard className="h-4 w-4 text-primary" />
                        <span className="text-base font-bold text-foreground">
                          ₹{activeRide.estimatedFare}
                        </span>
                      </div>
                    </div>
                  )}
                </CardContent>

                <CardFooter className="bg-muted/30 p-4 border-t">
                  {error && (
                    <p className="text-destructive text-xs mb-2">{error}</p>
                  )}
                  <Button
                    variant="destructive"
                    className="w-full"
                    onClick={() => cancelMutation.mutate(activeRide.id)}
                    disabled={cancelMutation.isPending || !canCancel}
                  >
                    {cancelMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Cancelling…
                      </>
                    ) : canCancel ? (
                      'Cancel Ride'
                    ) : (
                      'Cannot Cancel'
                    )}
                  </Button>
                </CardFooter>
              </Card>
            )}
          </div>

          {/* RIGHT COLUMN - Map */}
          <div className="h-[420px] md:h-[520px] bg-card rounded-xl shadow-sm overflow-hidden border border-border">
            {activeRide ? (
              <Map
                pickup={{
                  lat: parseFloat(activeRide.pickup.lat),
                  lng: parseFloat(activeRide.pickup.lng),
                  label: activeRide.pickup.address || 'Pickup',
                }}
                destination={{
                  lat: parseFloat(activeRide.destination.lat),
                  lng: parseFloat(activeRide.destination.lng),
                  label: activeRide.destination.address || 'Destination',
                }}
                driver={
                  activeRide.currentDriverLocation
                    ? {
                        lat: parseFloat(activeRide.currentDriverLocation.lat),
                        lng: parseFloat(activeRide.currentDriverLocation.lng),
                        label: 'Driver',
                      }
                    : undefined
                }
                className="h-full w-full"
              />
            ) : (
              <Map className="h-full w-full" />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
