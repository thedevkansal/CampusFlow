'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { Car, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-context';

export default function RegisterPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'PASSENGER' | 'DRIVER'>('PASSENGER');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [error, setError] = useState('');

  const registerMutation = useMutation({
    mutationFn: async () => {
      // Step 1: Create account
      await api.post('/auth/register', { name, email, password, role });

      // Step 2: Login to get token
      const loginRes = await api.post('/auth/login', { email, password });
      const { accessToken, user: userData } = loginRes.data.data;

      // Persist token so subsequent calls use it
      localStorage.setItem('token', accessToken);
      localStorage.setItem('user', JSON.stringify(userData));

      if (role === 'DRIVER') {
        // Step 3: Register vehicle profile
        await api.post('/drivers/register', {
          vehicleNumber: vehicleNumber || 'KA01AB0000',
          vehicleModel: vehicleModel || undefined,
        });

        // Step 4: Re-login so the new token includes driverId
        const reloginRes = await api.post('/auth/login', { email, password });
        const { accessToken: freshToken, user: freshUser } = reloginRes.data.data;
        return { token: freshToken, user: freshUser };
      }

      return { token: accessToken, user: userData };
    },
    onSuccess: ({ token, user: userData }) => {
      login(token, userData);
      router.push(userData.role === 'DRIVER' ? '/driver' : '/dashboard');
    },
    onError: (err: any) => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      const msg =
        err.response?.data?.message ||
        (Array.isArray(err.response?.data?.errors)
          ? err.response.data.errors[0]
          : null) ||
        'Registration failed. Please try again.';
      setError(msg);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    registerMutation.mutate();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo above card */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-primary font-bold text-xl">
            <div className="bg-primary/10 p-2 rounded-xl">
              <Car className="h-6 w-6" />
            </div>
            CampusFlow
          </Link>
        </div>

        <Card className="shadow-xl border border-border/50 bg-card">
          <CardHeader className="space-y-1 pb-6">
            <CardTitle className="text-2xl font-bold tracking-tight">Create account</CardTitle>
            <CardDescription>Join CampusFlow — commute smarter</CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="flex items-start gap-3 bg-destructive/10 text-destructive text-sm p-3 rounded-lg border border-destructive/20">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Role selector */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">I want to be a</Label>
                <Tabs
                  value={role}
                  onValueChange={(v) => setRole(v as 'PASSENGER' | 'DRIVER')}
                  className="w-full"
                >
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="PASSENGER">Passenger</TabsTrigger>
                    <TabsTrigger value="DRIVER">Driver</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-medium">Full name</Label>
                <Input
                  id="name"
                  placeholder="Alex Smith"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                  className="h-10"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="student@university.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="h-10"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="h-10"
                />
              </div>

              {role === 'DRIVER' && (
                <div className="space-y-3 pt-1 border-t border-border">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">
                    Vehicle details
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="vehicleNumber" className="text-sm font-medium">
                      Vehicle number <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="vehicleNumber"
                      placeholder="KA01AB1234"
                      value={vehicleNumber}
                      onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                      required
                      className="h-10 font-mono tracking-wide"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vehicleModel" className="text-sm font-medium">
                      Vehicle model <span className="text-muted-foreground text-xs">(optional)</span>
                    </Label>
                    <Input
                      id="vehicleModel"
                      placeholder="Honda Activa"
                      value={vehicleModel}
                      onChange={(e) => setVehicleModel(e.target.value)}
                      className="h-10"
                    />
                  </div>
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-10 text-sm font-semibold mt-2"
                disabled={registerMutation.isPending}
              >
                {registerMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating account…
                  </>
                ) : (
                  'Create account'
                )}
              </Button>
            </form>
          </CardContent>

          <CardFooter className="flex flex-col items-center border-t pt-4 pb-5 bg-muted/30">
            <p className="text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link href="/login" className="font-semibold text-primary hover:underline">
                Log in
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
