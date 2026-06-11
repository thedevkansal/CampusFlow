/**
 * socket-test.ts — manual smoke test for Phase 4A Socket.IO namespaces.
 *
 * Usage:
 *   PASSENGER_JWT=<token> DRIVER_JWT=<token> npx ts-node api-tests/socket-test.ts
 *
 * Both tokens must be fresh (not expired) and carry the correct roles.
 * Server must be running at WS_URL (default: http://localhost:3001).
 */

import { io, Socket } from 'socket.io-client';

const WS_URL = process.env.WS_URL ?? 'http://localhost:3001';
const PASSENGER_JWT = process.env.PASSENGER_JWT ?? '';
const DRIVER_JWT = process.env.DRIVER_JWT ?? '';

if (!PASSENGER_JWT || !DRIVER_JWT) {
  console.error('ERROR: PASSENGER_JWT and DRIVER_JWT env vars are required.');
  process.exit(1);
}

const EVENTS = [
  'ride_assigned',
  'ride_accepted',
  'ride_updated',
  'ride_cancelled',
  'ride_completed',
  'driver_location_updated',
  'connect_error',
];

function attach(socket: Socket, label: string): void {
  socket.on('connect', () =>
    console.log(`[${label}] connected  socketId=${socket.id}`),
  );
  socket.on('disconnect', (reason) =>
    console.log(`[${label}] disconnected  reason=${reason}`),
  );
  for (const event of EVENTS) {
    socket.on(event, (data: unknown) =>
      console.log(`[${label}] ${event}`, JSON.stringify(data, null, 2)),
    );
  }
}

// ── Passenger ────────────────────────────────────────────────────────────────
const passenger = io(`${WS_URL}/passenger`, {
  auth: { token: PASSENGER_JWT },
  transports: ['websocket'],
});
attach(passenger, 'PASSENGER');

// ── Driver ───────────────────────────────────────────────────────────────────
const driver = io(`${WS_URL}/driver`, {
  auth: { token: DRIVER_JWT },
  transports: ['websocket'],
});
attach(driver, 'DRIVER');

// Send a sample location update 3 seconds after connecting
driver.on('connect', () => {
  setTimeout(() => {
    driver.emit('driver:location', {
      latitude: 12.9716,
      longitude: 77.5946,
      heading: 90,
      speed: 20,
    });
    console.log('[DRIVER] sent driver:location');
  }, 3000);
});

console.log(`Connecting to ${WS_URL} ...`);
