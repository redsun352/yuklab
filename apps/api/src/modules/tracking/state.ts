export type DriverLocation = {
  driverId: string;
  lat: number;
  lng: number;
  heading?: number;
  speedKph?: number;
  accuracyM?: number;
  timestamp: string;
};

const locations = new Map<string, DriverLocation>();

export function setDriverLocation(location: DriverLocation): void {
  locations.set(location.driverId, location);
}

export function getDriverLocation(driverId: string): DriverLocation | undefined {
  return locations.get(driverId);
}
