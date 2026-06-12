'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/auth-context';

/**
 * Redirects to /login if the user is not authenticated.
 * Optionally enforces a required role — redirects to the role's home page if mismatched.
 * Returns { isLoading } so pages can render a loading state during hydration.
 */
export function useRequireAuth(requiredRole?: 'PASSENGER' | 'DRIVER') {
  const { isAuthenticated, isLoading, role, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }

    if (requiredRole && role && role !== requiredRole) {
      router.replace(role === 'DRIVER' ? '/driver' : '/dashboard');
    }
  }, [isAuthenticated, isLoading, role, router, requiredRole]);

  return { isLoading, user, role, isAuthenticated };
}
