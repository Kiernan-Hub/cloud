import { describe, expect, it } from "vitest";
import { isPast, overlapsDay } from "./event.js";

describe("overlapsDay", () => {
  // ADR-0001's addendum: the real Hoos Involved feed ships pure UTC instants
  // with no TZID. An 18:00Z-03:00Z event is one UVA evening (2pm-11pm EDT)
  // that merely crosses UTC midnight — a naive DTSTART date = DTEND date
  // check would misclassify it as spanning two days.
  it("treats a UVA evening event that crosses UTC midnight as a single day", () => {
    const event = {
      startAt: new Date("2026-09-02T18:00:00Z"),
      endAt: new Date("2026-09-03T03:00:00Z"),
    };

    // The UVA-local calendar day of 2026-09-02, expressed in UTC as
    // 2026-09-02T04:00:00Z (midnight EDT) through 2026-09-03T04:00:00Z.
    const localDayStart = new Date("2026-09-02T04:00:00Z");
    const localDayEnd = new Date("2026-09-03T04:00:00Z");

    expect(overlapsDay(event, localDayStart, localDayEnd)).toBe(true);

    // And it must not appear on the *next* UVA-local day.
    const nextDayStart = new Date("2026-09-03T04:00:00Z");
    const nextDayEnd = new Date("2026-09-04T04:00:00Z");
    expect(overlapsDay(event, nextDayStart, nextDayEnd)).toBe(false);
  });

  it("excludes an event that ends before the window starts", () => {
    const event = {
      startAt: new Date("2026-09-01T18:00:00Z"),
      endAt: new Date("2026-09-01T20:00:00Z"),
    };
    expect(
      overlapsDay(event, new Date("2026-09-02T00:00:00Z"), new Date("2026-09-03T00:00:00Z")),
    ).toBe(false);
  });
});

describe("isPast", () => {
  it("is false while the event is still in progress", () => {
    const event = { endAt: new Date("2026-09-05T00:00:00Z") };
    expect(isPast(event, new Date("2026-09-04T00:00:00Z"))).toBe(false);
  });

  it("is true once the end time has elapsed", () => {
    const event = { endAt: new Date("2026-09-01T00:00:00Z") };
    expect(isPast(event, new Date("2026-09-02T00:00:00Z"))).toBe(true);
  });
});
