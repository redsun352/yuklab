/** Convert a datetime-local value (which has no timezone) to an explicit UTC ISO timestamp. */
export function datetimeLocalToIso(value: string, timeZoneOffsetMinutes = new Date().getTimezoneOffset()): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) return undefined;

  const [, year, month, day, hour, minute, second = "00"] = match;
  const localAsUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  if (!Number.isFinite(localAsUtc)) return undefined;

  const date = new Date(localAsUtc + timeZoneOffsetMinutes * 60_000);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function isValidCoordinate(lat: number | null | undefined, lng: number | null | undefined): lat is number {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
