import { describe, expect, it } from "vitest";
import { formatEventWhen, formatLastChecked } from "./format.js";

describe("formatEventWhen", () => {
  it("shows a start-end range for a normal timed event", () => {
    const event = {
      startAt: new Date("2026-09-02T18:00:00Z"),
      endAt: new Date("2026-09-02T20:00:00Z"),
      isAllDay: false,
      startTimeUnknown: false,
    };
    // 18:00Z / 20:00Z is 2pm-4pm EDT.
    expect(formatEventWhen(event)).toContain("2:00");
    expect(formatEventWhen(event)).toContain("4:00");
  });

  it("labels an all-day event without a time range", () => {
    const event = {
      startAt: new Date("2026-09-02T04:00:00Z"),
      endAt: new Date("2026-09-03T04:00:00Z"),
      isAllDay: true,
      startTimeUnknown: false,
    };
    expect(formatEventWhen(event)).toContain("all day");
  });

  it("labels a start-time-unknown event without inventing a time", () => {
    const event = {
      startAt: new Date("2026-09-02T12:00:00Z"),
      endAt: new Date("2026-09-02T13:00:00Z"),
      isAllDay: false,
      startTimeUnknown: true,
    };
    expect(formatEventWhen(event)).toContain("time not listed");
  });
});

describe("formatLastChecked", () => {
  it("says 'just now' for a sync in the last minute", () => {
    const now = new Date("2026-09-02T12:00:30Z");
    expect(formatLastChecked(new Date("2026-09-02T12:00:00Z"), now)).toBe("checked just now");
  });

  it("reports minutes within the hour", () => {
    const now = new Date("2026-09-02T12:30:00Z");
    expect(formatLastChecked(new Date("2026-09-02T12:00:00Z"), now)).toBe("checked 30 min ago");
  });

  it("reports days for anything a day or older", () => {
    const now = new Date("2026-09-05T12:00:00Z");
    expect(formatLastChecked(new Date("2026-09-02T12:00:00Z"), now)).toBe("checked 3d ago");
  });
});
