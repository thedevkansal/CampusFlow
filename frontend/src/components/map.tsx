'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import 'leaflet/dist/leaflet.css';

// Dynamically import react-leaflet components to avoid SSR issues
const MapContainer = dynamic(() => import('react-leaflet').then(m => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then(m => m.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then(m => m.Marker), { ssr: false });
const Popup = dynamic(() => import('react-leaflet').then(m => m.Popup), { ssr: false });
const Polyline = dynamic(() => import('react-leaflet').then(m => m.Polyline), { ssr: false });

// Fix for default marker icons in Leaflet with Webpack/Next.js
// We import L dynamically inside useEffect to avoid SSR errors

export interface Location {
  lat: number;
  lng: number;
  label?: string;
}

interface MapProps {
  pickup?: Location;
  destination?: Location;
  driver?: Location;
  className?: string;
}

export function Map({ pickup, destination, driver, className = "h-64 w-full rounded-xl overflow-hidden" }: MapProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    import('leaflet').then((L) => {
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });
      setMounted(true);
    });
  }, []);

  if (!mounted) {
    return <div className={`bg-slate-100 animate-pulse ${className}`} />;
  }

  // Determine center and zoom based on available points
  let center: [number, number] = [12.9716, 77.5946]; // Default to Bangalore/Campus center
  if (pickup) {
    center = [pickup.lat, pickup.lng];
  } else if (driver) {
    center = [driver.lat, driver.lng];
  }

  return (
    <div className={className}>
      <MapContainer center={center} zoom={15} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {pickup && (
          <Marker position={[pickup.lat, pickup.lng]}>
            <Popup>{pickup.label || 'Pickup'}</Popup>
          </Marker>
        )}
        
        {destination && (
          <Marker position={[destination.lat, destination.lng]}>
            <Popup>{destination.label || 'Destination'}</Popup>
          </Marker>
        )}

        {driver && (
          <Marker position={[driver.lat, driver.lng]}>
            <Popup>{driver.label || 'Driver'}</Popup>
          </Marker>
        )}

        {pickup && destination && (
          <Polyline 
            positions={[
              [pickup.lat, pickup.lng],
              [destination.lat, destination.lng]
            ]} 
            color="#4f46e5" 
            weight={4}
            dashArray="8, 8"
          />
        )}
      </MapContainer>
    </div>
  );
}
