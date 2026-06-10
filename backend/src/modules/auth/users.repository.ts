/**
 * UsersRepository — data access layer for User records.
 *
 * All User-related database queries are isolated here.
 * The service layer calls this repository; controllers never touch Prisma directly.
 *
 * Source: docs/ENGINEERING_RULES.md — "Repository pattern. Service layer abstraction."
 * Source: docs/DATABASE.md — users table definition
 * Source: schema.prisma — User model
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@prisma/prisma.service';
import { User, UserRole } from '@prisma/client';

export interface CreateUserInput {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
}

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find a user by email. Returns null if not found.
   * Used during login and duplicate email checks.
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  /**
   * Find a user by ID, including their Driver record if they are a DRIVER.
   * The driverId is embedded in the JWT payload and used for ownership checks.
   *
   * Source: docs/RBAC.md — Ownership Check: "driverId.userId = req.user.id"
   * Source: common/types/index.ts — AuthenticatedUser.driverId
   */
  async findByIdWithDriver(
    id: string,
  ): Promise<(User & { driver: { id: string } | null }) | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        driver: {
          select: { id: true },
        },
      },
    });
  }

  /**
   * Find a user by ID without relations — lightweight lookup.
   */
  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  /**
   * Check if an email is already registered. Used before creating a new user.
   * More efficient than findByEmail when we only need existence.
   */
  async existsByEmail(email: string): Promise<boolean> {
    const count = await this.prisma.user.count({
      where: { email },
    });
    return count > 0;
  }

  /**
   * Create a new user record. Password must already be hashed before calling this.
   */
  async create(data: CreateUserInput): Promise<User> {
    return this.prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash: data.passwordHash,
        role: data.role,
      },
    });
  }
}
