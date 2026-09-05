import { describe, expect, it } from "vitest";

import { isValidTimeZone, localToUtc, UnknownTimeZoneError } from "./timezone";

const at = (year: number, month: number, day: number, hour: number, minute = 0) => ({
  year,
  month,
  day,
  hour,
  minute,
  second: 0,
});

describe("localToUtc", () => {
  it("handles UTC itself", () => {
    expect(localToUtc(at(2026, 6, 15, 12), "UTC").toISOString()).toBe(
      "2026-06-15T12:00:00.000Z",
    );
  });

  it("handles a zone with no DST", () => {
    // Phoenix stays on UTC-7 year round.
    expect(localToUtc(at(2026, 7, 15, 12), "America/Phoenix").toISOString()).toBe(
      "2026-07-15T19:00:00.000Z",
    );
  });

  it("handles a southern-hemisphere zone where DST runs the other way", () => {
    // Sydney is UTC+10 in July (standard) and UTC+11 in January (daylight).
    expect(localToUtc(at(2026, 7, 15, 12), "Australia/Sydney").toISOString()).toBe(
      "2026-07-15T02:00:00.000Z",
    );
    expect(localToUtc(at(2026, 1, 15, 12), "Australia/Sydney").toISOString()).toBe(
      "2026-01-15T01:00:00.000Z",
    );
  });

  it("handles a half-hour offset", () => {
    // Kolkata is UTC+5:30.
    expect(localToUtc(at(2026, 6, 15, 12), "Asia/Kolkata").toISOString()).toBe(
      "2026-06-15T06:30:00.000Z",
    );
  });

  it("handles a European DST transition", () => {
    // London: UTC+0 in winter, UTC+1 in summer.
    expect(localToUtc(at(2026, 1, 15, 12), "Europe/London").toISOString()).toBe(
      "2026-01-15T12:00:00.000Z",
    );
    expect(localToUtc(at(2026, 7, 15, 12), "Europe/London").toISOString()).toBe(
      "2026-07-15T11:00:00.000Z",
    );
  });

  it("round-trips a normal time back to the same wall clock", () => {
    const zones = ["America/New_York", "Europe/Berlin", "Asia/Tokyo"];
    for (const zone of zones) {
      const instant = localToUtc(at(2026, 6, 15, 14, 30), zone);
      const rendered = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      }).format(instant);
      expect(rendered).toBe("14:30");
    }
  });

  it("rejects an unknown zone instead of silently guessing", () => {
    expect(() => localToUtc(at(2026, 6, 15, 12), "Mars/Olympus")).toThrow(
      UnknownTimeZoneError,
    );
  });
});

describe("isValidTimeZone", () => {
  it("accepts real IANA names and rejects nonsense", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });
});
