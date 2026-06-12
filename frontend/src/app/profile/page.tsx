'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  User,
  Mail,
  Shield,
  Star,
  Car,
  LogOut,
  Edit2,
  Check,
  X,
  Loader2,
  Hash,
  Calendar,
  TrendingUp,
  AlertCircle,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/layout/navbar';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfileData {
  id: string;
  name: string;
  email: string;
  role: 'PASSENGER' | 'DRIVER' | 'ADMIN';
  averageRating?: string;
  totalRatings?: number;
  totalRides?: number;
  createdAt: string;
  driverId?: string;
}

interface DriverProfile {
  id: string;
  vehicleNumber: string;
  vehicleModel: string | null;
  vehicleColor: string | null;
  rating: string;
  totalRatings: number;
  status: string;
  isVerified: boolean;
}

interface EditDriverForm {
  vehicleNumber: string;
  vehicleModel: string;
  vehicleColor: string;
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  color = 'primary',
}: {
  icon: React.ElementType;
  label: string;
  value: string | number | undefined;
  color?: 'primary' | 'amber' | 'emerald';
}) {
  return (
    <div className="bg-muted/40 rounded-xl p-4 flex items-center gap-4">
      <div
        className={cn(
          'p-2.5 rounded-lg',
          color === 'amber'
            ? 'bg-amber-100 text-amber-600'
            : color === 'emerald'
            ? 'bg-emerald-100 text-emerald-600'
            : 'bg-primary/10 text-primary'
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className="text-lg font-bold text-foreground leading-tight">
          {value ?? '—'}
        </p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { logout, role, isAuthenticated, isLoading: authLoading } = useAuth();

  const [isEditingVehicle, setIsEditingVehicle] = useState(false);
  const [vehicleForm, setVehicleForm] = useState<EditDriverForm>({
    vehicleNumber: '',
    vehicleModel: '',
    vehicleColor: '',
  });

  // Guard: redirect to login if not authenticated (after hydration completes).
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  // ── Data fetching ──────────────────────────────────────────────────────────
  // Uses dedicated query keys (profile:auth, profile:driver) to avoid
  // conflicting with the dashboard's ['activeRide'] or ['driverProfile'] keys.

  const {
    data: profile,
    isLoading: isProfileLoading,
    isError: isProfileError,
  } = useQuery<ProfileData>({
    queryKey: ['profile:auth'],
    queryFn: async () => {
      const res = await api.get('/auth/profile');
      return res.data.data;
    },
    enabled: !authLoading && isAuthenticated,
    retry: false,
    staleTime: 60_000,
  });

  const {
    data: driverProfile,
    isLoading: isDriverLoading,
  } = useQuery<DriverProfile>({
    queryKey: ['profile:driver'],
    queryFn: async () => {
      const res = await api.get('/drivers/profile');
      return res.data.data;
    },
    enabled: !authLoading && isAuthenticated && role === 'DRIVER',
    retry: false,
    staleTime: 60_000,
  });

  // ── Vehicle edit mutation ──────────────────────────────────────────────────

  const updateVehicleMutation = useMutation({
    mutationFn: async (data: Partial<EditDriverForm>) => {
      const res = await api.patch('/drivers/profile', data);
      return res.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile:driver'] });
      setIsEditingVehicle(false);
    },
  });

  const handleStartEdit = () => {
    if (driverProfile) {
      setVehicleForm({
        vehicleNumber: driverProfile.vehicleNumber,
        vehicleModel: driverProfile.vehicleModel ?? '',
        vehicleColor: driverProfile.vehicleColor ?? '',
      });
    }
    setIsEditingVehicle(true);
  };

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  // ── Loading / error / auth states ─────────────────────────────────────────

  if (authLoading || isProfileLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm">Loading profile…</p>
          </div>
        </main>
      </div>
    );
  }

  if (isProfileError || !profile) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <Card className="w-full max-w-sm shadow-sm text-center">
            <CardContent className="p-8 flex flex-col items-center gap-4">
              <div className="bg-destructive/10 p-4 rounded-full">
                <AlertCircle className="h-8 w-8 text-destructive" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Could not load profile</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Please try refreshing the page.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['profile:auth'] })}
              >
                Retry
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const memberSince = profile.createdAt
    ? formatDistanceToNow(new Date(profile.createdAt), { addSuffix: true })
    : 'Unknown';

  const displayRating =
    role === 'DRIVER' && driverProfile
      ? parseFloat(driverProfile.rating).toFixed(1)
      : profile.averageRating
      ? parseFloat(profile.averageRating).toFixed(1)
      : '5.0';

  const displayTotalRatings =
    role === 'DRIVER' && driverProfile
      ? driverProfile.totalRatings
      : (profile.totalRatings ?? 0);

  const displayName =
    profile.name || profile.email?.split('@')[0] || 'User';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />

      <main className="flex-1 container mx-auto px-4 py-8 max-w-2xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground">Profile</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Member {memberSince}
          </p>
        </div>

        <div className="space-y-5">
          {/* Avatar + name card */}
          <Card className="shadow-sm overflow-hidden">
            <div className="h-16 bg-gradient-to-r from-primary/20 via-primary/10 to-transparent" />
            <CardContent className="px-6 pb-6 -mt-8">
              <div className="flex items-end gap-4">
                <div className="h-16 w-16 rounded-2xl bg-primary/10 border-4 border-background flex items-center justify-center text-primary font-bold text-xl shadow-sm shrink-0">
                  {displayName.slice(0, 2).toUpperCase()}
                </div>
                <div className="pb-1 flex-1 min-w-0">
                  <h2 className="text-lg font-bold text-foreground truncate">
                    {displayName}
                  </h2>
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
                      role === 'DRIVER'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-primary/10 text-primary'
                    )}
                  >
                    {role === 'DRIVER' ? 'Driver' : 'Passenger'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard
              icon={Star}
              label="Rating"
              value={displayRating}
              color="amber"
            />
            <StatCard
              icon={TrendingUp}
              label="Ratings received"
              value={displayTotalRatings}
              color="primary"
            />
            <StatCard
              icon={Hash}
              label="Total rides"
              value={profile.totalRides ?? 0}
              color="emerald"
            />
          </div>

          {/* Account info */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Account Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <InfoRow icon={User} label="Full name" value={profile.name} />
              <InfoRow icon={Mail} label="Email address" value={profile.email} />
              <InfoRow
                icon={Shield}
                label="Role"
                value={profile.role.charAt(0) + profile.role.slice(1).toLowerCase()}
              />
              <InfoRow icon={Calendar} label="Member since" value={memberSince} />
            </CardContent>
          </Card>

          {/* Driver vehicle info */}
          {role === 'DRIVER' && (
            <Card className="shadow-sm">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-base">Vehicle Information</CardTitle>
                {!isEditingVehicle && driverProfile && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-3 gap-1.5"
                    onClick={handleStartEdit}
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {isDriverLoading ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : !driverProfile ? (
                  <p className="text-sm text-muted-foreground">
                    Driver profile not found.
                  </p>
                ) : isEditingVehicle ? (
                  <VehicleEditForm
                    form={vehicleForm}
                    onChange={setVehicleForm}
                    onSave={() =>
                      updateVehicleMutation.mutate({
                        vehicleNumber: vehicleForm.vehicleNumber || undefined,
                        vehicleModel: vehicleForm.vehicleModel || undefined,
                        vehicleColor: vehicleForm.vehicleColor || undefined,
                      })
                    }
                    onCancel={() => setIsEditingVehicle(false)}
                    isPending={updateVehicleMutation.isPending}
                    error={
                      (updateVehicleMutation.error as any)?.response?.data
                        ?.message
                    }
                  />
                ) : (
                  <div className="space-y-4">
                    <InfoRow
                      icon={Car}
                      label="Vehicle number"
                      value={driverProfile.vehicleNumber}
                    />
                    {driverProfile.vehicleModel && (
                      <InfoRow
                        icon={Car}
                        label="Model"
                        value={driverProfile.vehicleModel}
                      />
                    )}
                    {driverProfile.vehicleColor && (
                      <InfoRow
                        icon={Car}
                        label="Colour"
                        value={driverProfile.vehicleColor}
                      />
                    )}
                    <div className="flex gap-2 pt-1">
                      <span
                        className={cn(
                          'px-2.5 py-1 rounded-full text-xs font-semibold',
                          driverProfile.isVerified
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-700'
                        )}
                      >
                        {driverProfile.isVerified ? 'Verified' : 'Unverified'}
                      </span>
                      <span
                        className={cn(
                          'px-2.5 py-1 rounded-full text-xs font-semibold',
                          driverProfile.status === 'ONLINE'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {driverProfile.status}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {role === 'PASSENGER' && (
            <p className="text-xs text-muted-foreground text-center px-4">
              Name and email editing requires{' '}
              <code className="font-mono">PATCH /auth/profile</code> — not yet
              implemented on the backend.
            </p>
          )}

          {/* Logout */}
          <Card className="shadow-sm border-destructive/20">
            <CardContent className="p-4">
              <Button
                variant="destructive"
                className="w-full gap-2"
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4" />
                Log out
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string | undefined;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="p-2 bg-muted rounded-lg shrink-0">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground">{value ?? '—'}</p>
      </div>
    </div>
  );
}

function VehicleEditForm({
  form,
  onChange,
  onSave,
  onCancel,
  isPending,
  error,
}: {
  form: EditDriverForm;
  onChange: (f: EditDriverForm) => void;
  onSave: () => void;
  onCancel: () => void;
  isPending: boolean;
  error?: string;
}) {
  return (
    <div className="space-y-3">
      {(['vehicleNumber', 'vehicleModel', 'vehicleColor'] as const).map(
        (field) => (
          <div key={field}>
            <label className="text-xs text-muted-foreground font-medium mb-1.5 block capitalize">
              {field.replace('vehicle', 'Vehicle ').trim()}
            </label>
            <input
              className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={form[field]}
              onChange={(e) => onChange({ ...form, [field]: e.target.value })}
            />
          </div>
        )
      )}
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          className="flex-1 gap-1.5"
          onClick={onSave}
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          Save
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 gap-1.5"
          onClick={onCancel}
          disabled={isPending}
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </Button>
      </div>
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
