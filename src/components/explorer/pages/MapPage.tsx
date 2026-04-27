'use client';

import { tokens, Activity } from '../tokens';
import { SectionTag, Label } from '../ui';
import dynamic from 'next/dynamic';

const MapContainer = dynamic(() => import('react-leaflet').then(mod => mod.MapContainer), { ssr: false });
const TileLayer    = dynamic(() => import('react-leaflet').then(mod => mod.TileLayer),    { ssr: false });
const Polyline     = dynamic(() => import('react-leaflet').then(mod => mod.Polyline),     { ssr: false });
const Marker       = dynamic(() => import('react-leaflet').then(mod => mod.Marker),       { ssr: false });
const Popup        = dynamic(() => import('react-leaflet').then(mod => mod.Popup),        { ssr: false });

interface Props {
  activities: Activity[];
  selectedActivity: Activity | null;
}

export function MapPage({ activities, selectedActivity }: Props) {
  const center: [number, number] = selectedActivity
    ? [selectedActivity.gps[0].lat, selectedActivity.gps[0].lng]
    : [45.75, 4.85];

  const cyclingCount = activities.filter(a => a.type === 'cycling').length;
  const hikingCount  = activities.filter(a => a.type === 'hiking').length;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '32px 40px 24px', borderBottom: `1px solid ${tokens.creamBorder}`, background: tokens.surface }}>
        <SectionTag num={2} title="CARTE DES PARCOURS" />
        <h1 style={{ fontFamily: "'Playfair Display'", fontSize: 36, fontWeight: 900, color: tokens.ink }}>
          {selectedActivity ? selectedActivity.title : <>Mes <em style={{ color: tokens.green, fontStyle: 'italic' }}>territoires</em></>}
        </h1>
      </div>
      <div style={{ flex: 1, position: 'relative' }}>
        <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            url="https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.cyclosm.org">CyclOSM</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          {selectedActivity && selectedActivity.gps.length > 0 && (
            <>
              <Polyline
                positions={selectedActivity.gps.map(p => [p.lat, p.lng])}
                pathOptions={{ color: selectedActivity.type === 'cycling' ? tokens.terra : tokens.green, weight: 4 }}
              />
              <Marker position={[selectedActivity.gps[0].lat, selectedActivity.gps[0].lng]}>
                <Popup>Départ : {selectedActivity.title}</Popup>
              </Marker>
              <Marker position={[selectedActivity.gps[selectedActivity.gps.length - 1].lat, selectedActivity.gps[selectedActivity.gps.length - 1].lng]}>
                <Popup>Arrivée : {selectedActivity.title}</Popup>
              </Marker>
            </>
          )}
        </MapContainer>
        <div style={{
          position: 'absolute', top: 24, right: 24, background: tokens.surface,
          border: `1px solid ${tokens.creamBorder}`, borderRadius: 4, padding: 16, minWidth: 180, zIndex: 1000,
        }}>
          <Label style={{ display: 'block', marginBottom: 12 }}>LÉGENDE</Label>
          {[
            { color: tokens.terra, label: 'Vélo',       count: cyclingCount },
            { color: tokens.green, label: 'Randonnée',  count: hikingCount  },
          ].map(l => (
            <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ width: 20, height: 2.5, background: l.color, borderRadius: 2 }} />
              <span style={{ fontFamily: "'Space Grotesk'", fontSize: 12, flex: 1 }}>{l.label}</span>
              <span style={{ fontFamily: "'Playfair Display'", fontSize: 14, fontWeight: 700 }}>{l.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
