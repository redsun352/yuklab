/** Convert a datetime-local value (which has no timezone) to an explicit UTC ISO timestamp. */
export function datetimeLocalToIso(value: string, timeZoneOffsetMinutes = new Date().getTimezoneOffset()): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) return undefined;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "00"] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return undefined;

  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const calendarCheck = new Date(localAsUtc);
  if (
    calendarCheck.getUTCFullYear() !== year ||
    calendarCheck.getUTCMonth() !== month - 1 ||
    calendarCheck.getUTCDate() !== day ||
    calendarCheck.getUTCHours() !== hour ||
    calendarCheck.getUTCMinutes() !== minute ||
    calendarCheck.getUTCSeconds() !== second
  ) return undefined;

  const date = new Date(localAsUtc + timeZoneOffsetMinutes * 60_000);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function isValidCoordinate(lat: number | null | undefined, lng: number | null | undefined): lat is number {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
