'use client';

import { useEffect, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MapPin,
  Car,
  Power,
  Map as MapIcon,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Navigation,
  WifiOff,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/layout/navbar';
import { Map } from '@/components/map';
import { api } from '@/lib/api';
import { useSocket } from '@/context/socket-context';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { cn } from '@/lib/utils';

const STATUS_LABELS: Record<string, string> = {
  ASSIGNED: 'New ride assigned',
  ACCEPTED: 'Heading to pickup',
  ARRIVING: 'Arrived at pickup',
  IN_PROGRESS: 'Ride in progress',
  COMPLETED: 'Ride completed',
};

// Campus center fallback for when geolocation is unavailable
const CAMPUS_LAT = 12.9716;
const CAMPUS_LNG = 77.5946;

function getGeolocation(): Promise<{ latitude: number; longitude: number; heading: number; speed: number }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ latitude: CAMPUS_LAT, longitude: CAMPUS_LNG, heading: 0, speed: 0 });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          heading: pos.coords.heading ?? 0,
          // Geolocation API returns speed in m/s; convert to km/h
          speed: pos.coords.speed != null ? pos.coords.speed * 3.6 : 0,
        });
      },
      () => {
        // Fallback to campus coordinates on permission denied / error
        resolve({ latitude: CAMPUS_LAT, longitude: CAMPUS_LNG, heading: 0, speed: 0 });
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  });
}

export default function DriverDashboardPage() {
  const queryClient = useQueryClient();
  const { driverSocket } = useSocket();
  const [isOnline, setIsOnline] = useState(false);
  const [error, setError] = useState('');
  const [socketError, setSocketError] = useState('');
  const locationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { isLoading: authLoading } = useRequireAuth('DRIVER');

  // Fetch driver profile — checks if driver profile exists and gets current status
  const { data: driverProfile, isLoading: isProfileLoading, error: profileError } = useQuery({
    queryKey: ['driverProfile'],
    queryFn: async () => {
      const res = await api.get('/drivers/profile');
      return res.data.data;
    },
    enabled: !authLoading,
    retry: false,
  });

  // Fetch active ride — uses driver-specific endpoint (DRIVER role)
  // Returns null on 404 so React Query clears stale data after ride completion
  const { data: activeRide, isLoading: isRideLoading } = useQuery({
    queryKey: ['activeRide'],
    queryFn: async () => {
      try {
        const res = await api.get('/rides/driver-active');
        return res.data.data ?? null;
      } catch (err: any) {
        if (err?.response?.status === 404) return null;
        throw err;
      }
    },
    enabled: !authLoading && !!driverProfile,
    retry: (count, err: any) => err?.response?.status !== 404 && count < 2,
  });

  // Sync online state from profile
  useEffect(() => {
    if (driverProfile?.status === 'ONLINE') {
      setIsOnline(true);
    }
  }, [driverProfile]);

  // Attach event listeners to the shared socket from SocketProvider.
  // Do NOT connect/disconnect here — SocketProvider manages the connection lifecycle.
  useEffect(() => {
    const socket = driverSocket;
    if (!socket || !driverProfile) return;

    const onConnectError = (err: Error) => setSocketError(`Live updates unavailable: ${err.message}`);
    const onConnect = () => {
      setSocketError('');
      socket.emit('session:restore', {
        lastEventTimestamp: new Date(Date.now() - 3600000).toISOString(),
      });
    };
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['activeRide'] });

    socket.on('connect_error', onConnectError);
    socket.on('connect', onConnect);
    socket.on('ride_assigned', invalidate);
    socket.on('ride_cancelled', invalidate);
    socket.on('ride_completed', invalidate);
    socket.on('ride_updated', invalidate);

    if (socket.connected) {
      socket.emit('session:restore', {
        lastEventTimestamp: new Date(Date.now() - 3600000).toISOString(),
      });
    }

    return () => {
      socket.off('connect_error', onConnectError);
      socket.off('connect', onConnect);
      socket.off('ride_assigned', invalidate);
      socket.off('ride_cancelled', invalidate);
      socket.off('ride_completed', invalidate);
      socket.off('ride_updated', invalidate);
      if (locationIntervalRef.current) clearInterval(locationIntervalRef.current);
    };
  }, [driverSocket, driverProfile, queryClient]);

  // Location streaming — uses Geolocation API with campus fallback
  useEffect(() => {
    if (!isOnline) {
      if (locationIntervalRef.current) clearInterval(locationIntervalRef.current);
      return;
    }

    const emitLocation = async () => {
      try {
        if (!driverSocket?.connected) return;
        const loc = await getGeolocation();
        driverSocket.emit('driver:location', {
          ...loc,
          timestamp: new Date().toISOString(),
        });
      } catch {
        // Socket might not be ready yet; skip this tick
      }
    };

    emitLocation();
    locationIntervalRef.current = setInterval(emitLocation, 2000);

    return () => {
      if (locationIntervalRef.current) clearInterval(locationIntervalRef.current);
    };
  }, [isOnline]);

  // Online toggle
  const toggleOnlineMutation = useMutation({
    mutationFn: async (goOnline: boolean) => {
      await api.post(goOnline ? '/drivers/online' : '/drivers/offline');
      return goOnline;
    },
    onSuccess: (goOnline) => {
      setIsOnline(goOnline);
      setError('');
    },
    onError: (err: any) => {
      setError(err.response?.data?.message || 'Failed to update status');
    },
  });

  // Ride lifecycle actions
  const actionMutation = useMutation({
    mutationFn: async ({ action, rideId }: { action: string; rideId: string }) => {
      let endpoint = `/rides/${rideId}/${action}`;
      let payload: Record<string, unknown> = {};

      if (action === 'cancel-driver') {
        payload = { reasonCode: 'NOT_AVAILABLE' };
      }

      const res = await api.post(endpoint, payload);
      return res.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activeRide'] });
      setError('');
    },
    onError: (err: any) => {
      setError(err.response?.data?.message || 'Action failed');
    },
  });

  const renderRideActions = () => {
    if (!activeRide) return null;

    const isPending = actionMutation.isPending;

    if (activeRide.status === 'ASSIGNED') {
      return (
        <div className="flex gap-3">
          <Button
            className="flex-1"
            size="lg"
            onClick={() => actionMutation.mutate({ action: 'accept', rideId: activeRide.id })}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Accept Ride
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => actionMutation.mutate({ action: 'cancel-driver', rideId: activeRide.id })}
            disabled={isPending}
          >
            Decline
          </Button>
        </div>
      );
    }

    if (activeRide.status === 'ACCEPTED') {
      return (
        <Button
          className="w-full"
          size="lg"
          onClick={() => actionMutation.mutate({ action: 'arrive', rideId: activeRide.id })}
          disabled={isPending}
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MapPin className="h-4 w-4 mr-2" />}
          Mark as Arrived
        </Button>
      );
    }

    if (activeRide.status === 'ARRIVING') {
      return (
        <Button
          className="w-full"
          size="lg"
          onClick={() => actionMutation.mutate({ action: 'start', rideId: activeRide.id })}
          disabled={isPending}
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Navigation className="h-4 w-4 mr-2" />}
          Start Ride
        </Button>
      );
    }

    if (activeRide.status === 'IN_PROGRESS') {
      return (
        <Button
          className="w-full"
          size="lg"
          onClick={() => actionMutation.mutate({ action: 'complete', rideId: activeRide.id })}
          disabled={isPending}
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
          Complete Ride
        </Button>
      );
    }

    return null;
  };

  if (authLoading || isProfileLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm">Loading driver dashboard…</p>
          </div>
        </main>
      </div>
    );
  }

  // Driver profile not found — prompt to set up
  const profileNotFound = (profileError as any)?.response?.status === 404;
  if (profileNotFound || (!driverProfile && !isProfileLoading)) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <Card className="w-full max-w-md shadow-sm text-center">
            <CardContent className="p-8 flex flex-col items-center gap-4">
              <div className="bg-amber-100 p-4 rounded-full">
                <Car className="h-8 w-8 text-amber-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">Driver profile not set up</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Your account doesn&apos;t have a driver profile yet. Please register again as a driver.
                </p>
              </div>
              <Button variant="outline" onClick={() => window.location.href = '/register'}>
                Register as Driver
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />

      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Driver Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {driverProfile?.vehicleNumber
              ? `Vehicle: ${driverProfile.vehicleNumber}`
              : 'Manage your rides and status'}
          </p>
        </div>

        {socketError && (
          <div className="mb-4 flex items-center gap-2 bg-amber-50 text-amber-800 text-sm px-4 py-3 rounded-lg border border-amber-200">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span>{socketError}</span>
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-6">
          {/* Left column — controls */}
          <div className="w-full md:w-72 shrink-0 space-y-4">
            {/* Online/Offline toggle */}
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Status</CardTitle>
                <CardDescription className="text-xs">
                  {isOnline ? 'You are receiving ride requests' : 'Go online to receive rides'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Status indicator */}
                <div className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium',
                  isOnline ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground'
                )}>
                  <div className={cn(
                    'w-2 h-2 rounded-full',
                    isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground'
                  )} />
                  {isOnline ? 'Online' : 'Offline'}
                </div>

                <Button
                  size="sm"
                  className="w-full gap-2"
                  variant={isOnline ? 'destructive' : 'default'}
                  onClick={() => toggleOnlineMutation.mutate(!isOnline)}
                  disabled={toggleOnlineMutation.isPending || !!activeRide}
                >
                  {toggleOnlineMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Power className="h-4 w-4" />
                  )}
                  {isOnline ? 'Go Offline' : 'Go Online'}
                </Button>

                {error && (
                  <div className="flex items-start gap-2 text-destructive text-xs bg-destructive/10 p-2 rounded">
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    {error}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Today's summary */}
            <Card className="shadow-sm">
              <CardContent className="p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Today&apos;s Summary
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">Earnings</p>
                    <p className="text-lg font-bold text-foreground mt-0.5">₹0.00</p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">Rides</p>
                    <p className="text-lg font-bold text-foreground mt-0.5">0</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right column — ride + map */}
          <div className="flex-1 space-y-4 min-w-0">
            {isRideLoading ? (
              <Card className="shadow-sm h-40 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </Card>
            ) : !activeRide ? (
              <Card className="shadow-sm">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="bg-muted/50 p-4 rounded-full mb-4">
                    <MapIcon className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h3 className="font-semibold text-foreground">No active ride</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {isOnline ? 'Waiting for a ride request…' : 'Go online to start receiving rides'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card className="shadow-sm overflow-hidden">
                {/* Status banner */}
                <div
                  className={cn(
                    'px-5 py-3 flex items-center justify-between',
                    activeRide.status === 'ASSIGNED'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-primary/10 text-primary'
                  )}
                >
                  <span className="text-sm font-semibold">
                    {STATUS_LABELS[activeRide.status] ?? activeRide.status.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs opacity-60 font-mono">
                    #{activeRide.id.slice(-6).toUpperCase()}
                  </span>
                </div>

                <CardContent className="p-5 space-y-5">
                  {/* Passenger info */}
                  <div className="flex items-center gap-3 bg-muted/50 rounded-xl p-4">
                    <div className="h-11 w-11 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-base shrink-0">
                      {(activeRide.passengerName ?? 'P').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground text-sm">
                        {activeRide.passengerName || 'Passenger'}
                      </p>
                    </div>
                    {activeRide.estimatedFare && (
                      <div className="text-right shrink-0">
                        <p className="text-xs text-muted-foreground">Est. Fare</p>
                        <p className="font-bold text-base text-primary">₹{activeRide.estimatedFare}</p>
                      </div>
                    )}
                  </div>

                  {/* Route */}
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

                  {/* Action buttons */}
                  <div className="pt-3 border-t border-border">
                    {renderRideActions()}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Map */}
            <div className="h-64 md:h-72 bg-card rounded-xl shadow-sm overflow-hidden border border-border">
              <Map
                pickup={
                  activeRide
                    ? { lat: parseFloat(activeRide.pickup.lat), lng: parseFloat(activeRide.pickup.lng) }
                    : undefined
                }
                destination={
                  activeRide
                    ? { lat: parseFloat(activeRide.destination.lat), lng: parseFloat(activeRide.destination.lng) }
                    : undefined
                }
                className="h-full w-full"
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
