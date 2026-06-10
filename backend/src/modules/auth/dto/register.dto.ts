/**
 * RegisterDto — validated payload for POST /auth/register.
 *
 * Source: docs/RBAC.md — "Role is never client-settable after registration"
 *         ADMIN accounts are provisioned out-of-band; registration rejects ADMIN role.
 * Source: docs/API_CONTRACTS.md — POST /auth/register
 * Source: docs/ENGINEERING_RULES.md — "DTO validation mandatory"
 */

import {
  IsEmail,
  IsEnum,
  IsNotIn,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '@common/types';

export class RegisterDto {
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  @MaxLength(100, { message: 'Name must not exceed 100 characters' })
  name!: string;

  @IsEmail({}, { message: 'Must be a valid email address' })
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128, { message: 'Password must not exceed 128 characters' })
  password!: string;

  /**
   * Role is optional — defaults to PASSENGER if omitted.
   * ADMIN is explicitly forbidden here; admin accounts are provisioned out-of-band.
   * Source: docs/RBAC.md — POST /auth/register: ADMIN ❌
   */
  @IsEnum(Role, { message: 'Role must be PASSENGER or DRIVER' })
  @IsNotIn([Role.ADMIN], { message: 'ADMIN role cannot be self-registered' })
  role: Role = Role.PASSENGER;
}
