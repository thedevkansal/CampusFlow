import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

// We manage one socket connection per namespace
let passengerSocket: Socket | null = null;
let driverSocket: Socket | null = null;

/**
 * Initializes and returns the socket connection for the given namespace.
 * Will reconnect if token changes or if forced.
 */
export const getSocket = (namespace: 'passenger' | 'driver', forceNew = false): Socket => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  
  if (!token) {
    throw new Error('Cannot connect to socket without token');
  }

  // Pick the right socket reference
  let currentSocket = namespace === 'passenger' ? passengerSocket : driverSocket;

  // If forced or not created yet, create a new one
  if (!currentSocket || forceNew) {
    if (currentSocket) {
      currentSocket.disconnect();
    }

    currentSocket = io(`${SOCKET_URL}/${namespace}`, {
      auth: { token },
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.5,
    });

    if (namespace === 'passenger') passengerSocket = currentSocket;
    if (namespace === 'driver') driverSocket = currentSocket;
  }

  return currentSocket;
};

export const disconnectSocket = (namespace: 'passenger' | 'driver') => {
  if (namespace === 'passenger' && passengerSocket) {
    passengerSocket.disconnect();
    passengerSocket = null;
  }
  if (namespace === 'driver' && driverSocket) {
    driverSocket.disconnect();
    driverSocket = null;
  }
};
