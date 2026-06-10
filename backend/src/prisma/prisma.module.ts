/**
 * PrismaModule — global module exposing PrismaService.
 * All database access goes through PrismaService.
 */

import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
