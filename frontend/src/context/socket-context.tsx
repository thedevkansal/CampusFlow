'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  ReactNode,
} from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/context/auth-context';

const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

interface SocketContextType {
  passengerSocket: Socket | null;
  driverSocket: Socket | null;
}

const SocketContext = createContext<SocketContextType>({
  passengerSocket: null,
  driverSocket: null,
});

export function SocketProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, role, token } = useAuth();

  // Use state (not ref) so context consumers re-render when socket becomes available.
  const [passengerSocket, setPassengerSocket] = useState<Socket | null>(null);
  const [driverSocket, setDriverSocket] = useState<Socket | null>(null);

  // Prevent double-creation in React Strict Mode and fast re-renders.
  const creatingPassenger = useRef(false);
  const creatingDriver = useRef(false);

  useEffect(() => {
    if (isLoading) return;

    const authToken =
      token ?? (typeof window !== 'undefined' ? localStorage.getItem('token') : null);

    if (!isAuthenticated || !authToken) {
      // Logged out — tear down any open sockets
      setPassengerSocket((prev) => {
        prev?.disconnect();
        return null;
      });
      setDriverSocket((prev) => {
        prev?.disconnect();
        return null;
      });
      creatingPassenger.current = false;
      creatingDriver.current = false;
      return;
    }

    // Connect the role-appropriate namespace once. We guard with a ref to
    // prevent double-creation when the effect re-runs before the first
    // setState has propagated (e.g. Strict Mode double-invoke).
    if (role === 'PASSENGER' && !creatingPassenger.current) {
      creatingPassenger.current = true;
      setPassengerSocket((prev) => {
        if (prev?.connected || prev?.active) return prev; // already live
        prev?.disconnect();
        return io(`${SOCKET_URL}/passenger`, {
          auth: { token: authToken },
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 30000,
          randomizationFactor: 0.5,
        });
      });
    }

    if (role === 'DRIVER' && !creatingDriver.current) {
      creatingDriver.current = true;
      setDriverSocket((prev) => {
        if (prev?.connected || prev?.active) return prev;
        prev?.disconnect();
        return io(`${SOCKET_URL}/driver`, {
          auth: { token: authToken },
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 30000,
          randomizationFactor: 0.5,
        });
      });
    }
  }, [isAuthenticated, isLoading, role, token]);

  return (
    <SocketContext.Provider value={{ passengerSocket, driverSocket }}>
      {children}
    </SocketContext.Provider>
  );
}

export const useSocket = () => useContext(SocketContext);
