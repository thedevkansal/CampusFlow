/**
 * LoginDto — validated payload for POST /auth/login.
 *
 * Source: docs/API_CONTRACTS.md — POST /auth/login
 * Source: docs/ENGINEERING_RULES.md — "DTO validation mandatory"
 */

import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Must be a valid email address' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  password!: string;
}
