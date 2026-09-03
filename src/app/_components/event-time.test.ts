import { describe, expect, it } from "vitest";

import { formatEventTime, formatLastChecked } from "./event-time";

const TZ = "America/New_York";

describe("formatEventTime", () => {
  it("renders in the event's timezone, not the server's", () => {
    // 00:30 UTC on Jan 2 is 19:30 on Jan 1 in New York.
    const formatted = formatEventTime(new Date("2030-01-02T00:30:00Z"), null, TZ, false);
    expect(formatted).toContain("Jan 1");
    expect(formatted).toContain("7:30");
  });

  it("says so when no end time is listed rather than inventing one", () => {
    const formatted = formatEventTime(new Date("2030-01-02T00:30:00Z"), null, TZ, false);
    expect(formatted).toMatch(/end time not listed/i);
  });

  it("marks all-day events without a time range", () => {
    const formatted = formatEventTime(
      new Date("2030-01-02T00:30:00Z"),
      new Date("2030-01-03T00:30:00Z"),
      TZ,
      true,
    );
    expect(formatted).toMatch(/all day/i);
  });

  it("shows a same-day range as start – end", () => {
    const formatted = formatEventTime(
      new Date("2030-01-02T18:00:00Z"),
      new Date("2030-01-02T20:00:00Z"),
      TZ,
      false,
    );
    expect(formatted).toMatch(/1:00.*–.*3:00/);
  });
});

describe("formatLastChecked", () => {
  it("describes recent checks in minutes", () => {
    expect(formatLastChecked(new Date(Date.now() - 5 * 60 * 1000))).toBe("5 min ago");
  });

  it("describes older checks in days", () => {
    expect(formatLastChecked(new Date(Date.now() - 50 * 60 * 60 * 1000))).toBe(
      "2 days ago",
    );
  });
});
