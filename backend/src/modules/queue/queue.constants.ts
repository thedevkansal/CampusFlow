/**
 * BullMQ Queue Names and Priority Constants.
 *
 * Defines all queue names and job priorities used across the application.
 * Every queue enqueue call must reference these constants — no magic strings.
 *
 * Source: docs/MATCHING_ENGINE.md — "BullMQ Queue Design"
 */

/** Queue names */
export const QUEUE_NAMES = {
  RIDE_MATCHING: 'ride-matching',
  NOTIFICATIONS: 'notifications',
  ANALYTICS_INGESTION: 'analytics-ingestion',
  DEMAND_FORECASTING: 'demand-forecasting',
  LOCATION_PERSISTENCE: 'location-persistence',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Job priority levels (lower number = higher priority in BullMQ) */
export const JOB_PRIORITY = {
  CRITICAL: 1,
  HIGH: 5,
  MEDIUM: 10,
  LOW: 20,
} as const;

/** Job names within each queue */
export const JOB_NAMES = {
  // ride-matching queue
  MATCH_RIDE: 'match-ride',
  ACCEPTANCE_TIMEOUT: 'acceptance-timeout',

  // notifications queue
  NOTIFY_DRIVER_ASSIGNED: 'notify-driver-assigned',
  NOTIFY_PASSENGER_ACCEPTED: 'notify-passenger-accepted',
  NOTIFY_RIDE_CANCELLED: 'notify-ride-cancelled',
  NOTIFY_NO_DRIVER: 'notify-no-driver',
  NOTIFY_RATING_PROMPT: 'notify-rating-prompt',

  // analytics-ingestion queue
  INGEST_RIDE_COMPLETED: 'ingest-ride-completed',
  INGEST_ANALYTICS_EVENT: 'ingest-analytics-event',

  // demand-forecasting queue
  COMPUTE_DEMAND_FORECAST: 'compute-demand-forecast',

  // location-persistence queue
  FLUSH_DRIVER_LOCATION: 'flush-driver-location',
  CLEANUP_STALE_DRIVERS: 'cleanup-stale-drivers',
} as const;

/** BullMQ default job options per queue */
export const QUEUE_JOB_OPTIONS = {
  [QUEUE_NAMES.RIDE_MATCHING]: {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 1000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
    priority: JOB_PRIORITY.CRITICAL,
  },
  [QUEUE_NAMES.NOTIFICATIONS]: {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 500 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
    priority: JOB_PRIORITY.HIGH,
  },
  [QUEUE_NAMES.ANALYTICS_INGESTION]: {
    attempts: 2,
    backoff: { type: 'fixed' as const, delay: 2000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 100 },
    priority: JOB_PRIORITY.MEDIUM,
  },
  [QUEUE_NAMES.DEMAND_FORECASTING]: {
    attempts: 2,
    backoff: { type: 'fixed' as const, delay: 5000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 20 },
    priority: JOB_PRIORITY.LOW,
  },
  [QUEUE_NAMES.LOCATION_PERSISTENCE]: {
    attempts: 2,
    backoff: { type: 'fixed' as const, delay: 1000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 50 },
    priority: JOB_PRIORITY.LOW,
  },
} as const;
