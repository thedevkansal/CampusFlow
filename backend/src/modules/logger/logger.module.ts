/**
 * LoggerModule — configures Winston as the global NestJS logger.
 *
 * Log levels:
 * - production:  warn, error
 * - development: debug, verbose, log, warn, error
 *
 * Transports:
 * - Console (always)
 * - File: logs/error.log (errors only)
 * - File: logs/combined.log (all levels)
 *
 * All logs include: timestamp, level, context, message, and any metadata.
 */

import { Global, Module } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import { AppConfigService } from '@common/config/app-config.service';
import { AppConfigModule } from '@common/config/config.module';

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, context, stack, ...meta }) => {
    const ctx = context ? `[${String(context)}] ` : '';
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    const stackStr = stack ? `\n${String(stack)}` : '';
    const msg =
      typeof message === 'object' && message !== null
        ? JSON.stringify(message, null, 2)
        : String(message);
    return `${String(ts)} ${level}: ${ctx}${msg}${metaStr}${stackStr}`;
  }),
);

const prodFormat = combine(timestamp(), errors({ stack: true }), json());

@Global()
@Module({
  imports: [
    AppConfigModule,
    WinstonModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const isProd = config.isProduction;

        const transports: winston.transport[] = [
          new winston.transports.Console({
            format: isProd ? prodFormat : devFormat,
            silent: false,
          }),
          new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            format: prodFormat,
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
          }),
          new winston.transports.File({
            filename: 'logs/combined.log',
            format: prodFormat,
            maxsize: 50 * 1024 * 1024, // 50MB
            maxFiles: 10,
          }),
        ];

        return {
          level: isProd ? 'warn' : 'debug',
          transports,
          exitOnError: false,
        };
      },
    }),
  ],
})
export class LoggerModule {}
