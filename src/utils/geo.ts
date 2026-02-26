export const BARCELONA = { lat: 41.3851, lng: 2.1734 };
const EARTH_RADIUS_KM = 6371;
export const MAX_DISTANCE_KM = 80;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineDistance(
  lat: number,
  lng: number,
  origin = BARCELONA
): number {
  const dLat = toRad(lat - origin.lat);
  const dLng = toRad(lng - origin.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(origin.lat)) *
      Math.cos(toRad(lat)) *
      Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isWithinRadius(lat: number, lng: number): boolean {
  return haversineDistance(lat, lng) <= MAX_DISTANCE_KM;
}
