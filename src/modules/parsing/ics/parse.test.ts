// Parser tests run entirely against saved fixtures — no network, no
// database. That is what OVERVIEW.md section 12 requires so an external
// site changing cannot make CI flaky.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseIcs } from "./parse";

const FIXTURES = join(import.meta.dirname, "fixtures");
const TZ = "America/New_York";

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

const sample = parseIcs(loadFixture("sample-calendar.ics"), {
  fallbackTimeZone: TZ,
});

function eventByUid(uid: string) {
  const event = sample.events.find((candidate) => candidate.uid.startsWith(uid));
  if (!event) throw new Error(`fixture missing event ${uid}`);
  return event;
}

describe("calendar-level parsing", () => {
  it("reads the calendar name", () => {
    expect(sample.calendarName).toBe("Fixture Calendar");
  });

  it("parses the well-formed events and skips only the broken ones", () => {
    // 8 good events, 3 deliberately broken.
    expect(sample.events).toHaveLength(8);
    expect(sample.issues).toHaveLength(3);
  });
});

describe("a malformed record does not fail the batch", () => {
  it("reports a missing UID rather than importing it", () => {
    // No UID means no idempotent import — a silent accept would create a
    // duplicate on every single run.
    const issue = sample.issues.find((entry) => /UID/i.test(entry.reason));
    expect(issue).toBeDefined();
    expect(issue!.reason).toMatch(/idempotent/i);
  });

  it("reports a missing DTSTART", () => {
    const issue = sample.issues.find((entry) => /DTSTART/i.test(entry.reason));
    expect(issue).toBeDefined();
    expect(issue!.uid).toContain("nostart-010");
  });

  it("reports an unparseable date", () => {
    const issue = sample.issues.find((entry) => /Unrecognized date/i.test(entry.reason));
    expect(issue).toBeDefined();
    expect(issue!.uid).toContain("baddate-011");
  });

  it("records where each bad record was, for debugging", () => {
    for (const issue of sample.issues) {
      expect(issue.eventIndex).toBeGreaterThan(0);
    }
  });
});

describe("basic fields", () => {
  const event = eventByUid("basic-001");

  it("extracts summary, description, location and url", () => {
    expect(event.summary).toBe("Intro to Astronomy Lecture");
    expect(event.description).toBe("A talk about telescopes and the night sky.");
    expect(event.location).toBe("Rice Hall 130");
    expect(event.url).toBe("https://example.invalid/events/basic-001");
  });

  it("splits categories on commas", () => {
    expect(event.categories).toEqual(["Lecture", "Science"]);
  });

  it("reads change timestamps", () => {
    expect(event.created?.toISOString()).toBe("2026-01-01T12:00:00.000Z");
    expect(event.lastModified?.toISOString()).toBe("2026-03-01T09:00:00.000Z");
  });
});

describe("timezone handling", () => {
  it("converts a zoned wall time to the correct instant during EDT", () => {
    // 2:30pm on 15 March 2026 in New York is UTC-4 (daylight time).
    expect(eventByUid("basic-001").start.at.toISOString()).toBe(
      "2026-03-15T18:30:00.000Z",
    );
  });

  it("treats a Z-suffixed value as absolute UTC", () => {
    const event = eventByUid("folded-003");
    expect(event.start.at.toISOString()).toBe("2026-04-01T18:00:00.000Z");
    expect(event.start.timeZone).toBe("UTC");
    expect(event.start.floating).toBe(false);
  });

  it("flags a floating time and applies the fallback zone", () => {
    const event = eventByUid("floating-007");
    expect(event.start.floating).toBe(true);
    expect(event.start.timeZone).toBe(TZ);
    // 9am floating, interpreted as New York time in April (UTC-4).
    expect(event.start.at.toISOString()).toBe("2026-04-12T13:00:00.000Z");
  });

  it("accepts a quoted TZID parameter", () => {
    const event = eventByUid("quoted-008");
    expect(event.start.timeZone).toBe(TZ);
    expect(event.start.floating).toBe(false);
    expect(event.start.at.toISOString()).toBe("2026-04-15T15:00:00.000Z");
  });
});

describe("daylight saving edge cases", () => {
  const dst = parseIcs(loadFixture("dst-edge-cases.ics"), {
    fallbackTimeZone: TZ,
  });

  function dstEvent(uid: string) {
    return dst.events.find((event) => event.uid.startsWith(uid))!;
  }

  it("parses every DST fixture without throwing", () => {
    expect(dst.events).toHaveLength(4);
    expect(dst.issues).toHaveLength(0);
  });

  it("uses standard time before the March switch", () => {
    // Noon on 1 March is EST, UTC-5.
    expect(dstEvent("dst-before").start.at.toISOString()).toBe(
      "2026-03-01T17:00:00.000Z",
    );
  });

  it("uses daylight time after the March switch", () => {
    // Noon on 1 April is EDT, UTC-4.
    expect(dstEvent("dst-after").start.at.toISOString()).toBe("2026-04-01T16:00:00.000Z");
  });

  it("resolves a nonexistent spring-forward time to a real instant", () => {
    // 2:30am on 8 March 2026 does not exist in New York; clocks jump 2->3.
    const at = dstEvent("dst-gap").start.at;
    expect(Number.isNaN(at.getTime())).toBe(false);
    expect(at.toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("resolves an ambiguous fall-back time to the first occurrence", () => {
    // 1:30am on 1 November 2026 happens twice. The first is still EDT
    // (UTC-4) => 05:30Z; the second is EST (UTC-5) => 06:30Z.
    expect(dstEvent("dst-overlap").start.at.toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });
});

describe("all-day events", () => {
  const event = eventByUid("allday-002");

  it("marks a DATE value as all-day", () => {
    expect(event.start.isDate).toBe(true);
  });

  it("resolves to local midnight, not UTC midnight", () => {
    // 20 March 2026 in New York is EDT (UTC-4), so local midnight is 04:00Z.
    expect(event.start.at.toISOString()).toBe("2026-03-20T04:00:00.000Z");
  });
});

describe("line folding and text escaping", () => {
  const event = eventByUid("folded-003");

  it("rejoins a folded summary without leaving a space artifact", () => {
    expect(event.summary).toBe(
      "An event with a very long title that the calendar server has wrapped across multiple lines",
    );
  });

  it("unescapes newlines, commas and semicolons", () => {
    expect(event.description).toContain("Line one\nLine two");
    expect(event.description).toContain(", with an escaped comma; and semicolon.");
  });
});

describe("status", () => {
  it("maps STATUS:CANCELLED", () => {
    expect(eventByUid("cancelled-004").status).toBe("cancelled");
  });

  it("treats a missing STATUS as scheduled, never cancelled", () => {
    // Absence of information is not evidence of cancellation — this is the
    // rule the whole freshness model rests on.
    expect(eventByUid("noend-005").status).toBe("scheduled");
  });
});

describe("optional fields", () => {
  it("returns null rather than inventing an end time", () => {
    expect(eventByUid("noend-005").end).toBeNull();
  });

  it("returns null for absent description and location", () => {
    const event = eventByUid("allday-002");
    expect(event.description).toBeNull();
    expect(event.location).toBeNull();
  });
});

describe("recurrence", () => {
  it("records an RRULE without expanding it", () => {
    const event = eventByUid("recurring-006");
    expect(event.recurrenceRule).toBe("FREQ=WEEKLY;BYDAY=TU;COUNT=10");
    // Expansion is deferred deliberately; the rule is kept so the
    // information is not silently dropped.
    expect(sample.events.filter((e) => e.uid.startsWith("recurring"))).toHaveLength(1);
  });
});

describe("input robustness", () => {
  it("handles CRLF line endings", () => {
    const crlf = loadFixture("sample-calendar.ics").replace(/\n/g, "\r\n");
    expect(parseIcs(crlf, { fallbackTimeZone: TZ }).events).toHaveLength(8);
  });

  it("returns empty results for an empty document rather than throwing", () => {
    const result = parseIcs("", { fallbackTimeZone: TZ });
    expect(result.events).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it("ignores a calendar with no events", () => {
    const result = parseIcs("BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR", {
      fallbackTimeZone: TZ,
    });
    expect(result.events).toEqual([]);
  });
});
