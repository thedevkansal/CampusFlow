/**
 * Auth response types returned from AuthService to AuthController.
 *
 * These are plain interfaces (not class-transformer DTOs) because they are
 * constructed server-side, not deserialized from client input.
 *
 * Source: docs/API_CONTRACTS.md — Response Format { success, data, message }
 * Source: docs/RBAC.md — GET /auth/profile returns role-specific profile
 */

import { Role } from '@common/types';

// ─── Register ────────────────────────────────────────────────────────────────

export interface RegisterResponseData {
  userId: string;
  email: string;
  name: string;
  role: Role;
}

// ─── Login ───────────────────────────────────────────────────────────────────

export interface LoginResponseData {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: Role;
  };
}

// ─── Profile ─────────────────────────────────────────────────────────────────

export interface ProfileResponseData {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: Date;
  averageRating: string;
  totalRatings: number;
  totalRides: number;
  /** Present only when role === DRIVER */
  driverId?: string;
}
