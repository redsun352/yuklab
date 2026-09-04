import { describe, expect, it } from "vitest";
import { datetimeLocalToIso, isValidCoordinate } from "./order-utils";

describe("order input utilities", () => {
  it("converts local datetime input to an explicit UTC ISO timestamp", () => {
    expect(datetimeLocalToIso("2026-09-04T16:30", -180)).toBe("2026-09-04T13:30:00.000Z");
    expect(datetimeLocalToIso("2026-09-04T16:30", 0)).toBe("2026-09-04T16:30:00.000Z");
  });

  it("rejects malformed datetime values", () => {
    expect(datetimeLocalToIso("2026/09/04 16:30", -180)).toBeUndefined();
    expect(datetimeLocalToIso("", -180)).toBeUndefined();
  });

  it("validates geographic coordinates", () => {
    expect(isValidCoordinate(38.72, 35.48)).toBe(true);
    expect(isValidCoordinate(91, 35.48)).toBe(false);
    expect(isValidCoordinate(38.72, 181)).toBe(false);
    expect(isValidCoordinate(Number.NaN, 35.48)).toBe(false);
  });
});
