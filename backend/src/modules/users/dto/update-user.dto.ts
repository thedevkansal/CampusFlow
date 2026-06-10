/**
 * UpdateUserDto — validated payload for PATCH /users/me.
 *
 * Only `name` is exposed. Email, role, and id are immutable and are
 * never accepted here — the global ValidationPipe (forbidNonWhitelisted: true)
 * rejects any other field automatically.
 *
 * Source: docs/RBAC.md — PATCH /users/profile ownership check
 * Source: docs/ENGINEERING_RULES.md — "DTO validation mandatory"
 */

import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  @MaxLength(100, { message: 'Name must not exceed 100 characters' })
  name?: string;
}
