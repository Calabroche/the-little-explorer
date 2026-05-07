import { NavigatePage } from '@/components/explorer/navigate/NavigatePage';

// Full-screen turn-by-turn navigation view, served at
// /navigate/<itineraryId>. This route exists outside the catch-all
// SPA shell so the navigation chrome (sidebar, headers) doesn't get
// in the way on a phone.
//
// We pass the params straight through; the client component reads the
// itinerary from localStorage and fetches fresh maneuvers from OSRM.
export default function NavigateRoute({ params }: { params: { id: string } }) {
  return <NavigatePage itineraryId={params.id} />;
}
