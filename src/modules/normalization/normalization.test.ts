import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseIcs, type IcsEvent } from "@/modules/parsing";

import {
  normalizeIcsEvent,
  normalizeIcsEvents,
  normalizeOrganizationName,
} from "./index";

const FIXTURE = readFileSync(
  join(import.meta.dirname, "../parsing/ics/fixtures/sample-calendar.ics"),
  "utf8",
);

const parsed = parseIcs(FIXTURE, { fallbackTimeZone: "America/New_York" });

const options = {
  fallbackUrl: "https://example.invalid/calendar",
  defaultOrganizationName: "Test Org",
};

function icsEvent(uid: string): IcsEvent {
  return parsed.events.find((event) => event.uid.startsWith(uid))!;
}

describe("normalizeIcsEvents", () => {
  it("normalizes every parseable event", () => {
    const result = normalizeIcsEvents(parsed.events, options);
    expect(result.candidates).toHaveLength(8);
    expect(result.issues).toHaveLength(0);
  });

  it("keeps the UID as the idempotency key", () => {
    const result = normalizeIcsEvents(parsed.events, options);
    for (const candidate of result.candidates) {
      expect(candidate.sourceEventKey).toBeTruthy();
    }
    // Keys must be unique, or the upsert would fight itself.
    const keys = result.candidates.map((c) => c.sourceEventKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the first of a duplicated UID and reports the rest", () => {
    const duplicated = [icsEvent("basic-001"), icsEvent("basic-001")];
    const result = normalizeIcsEvents(duplicated, options);

    expect(result.candidates).toHaveLength(1);
    expect(result.issues[0]!.reason).toMatch(/duplicate uid/i);
  });
});

describe("provenance", () => {
  it("prefers the event's own URL", () => {
    const candidate = normalizeIcsEvent(icsEvent("basic-001"), options);
    expect(candidate.canonicalUrl).toBe("https://example.invalid/events/basic-001");
  });

  it("falls back to the calendar URL when the event has none", () => {
    const candidate = normalizeIcsEvent(icsEvent("allday-002"), options);
    // A link to the calendar beats no link at all — provenance is required.
    expect(candidate.canonicalUrl).toBe(options.fallbackUrl);
  });

  it("refuses an event when no usable URL exists at all", () => {
    expect(() =>
      normalizeIcsEvent(icsEvent("allday-002"), {
        ...options,
        fallbackUrl: "not-a-url",
      }),
    ).toThrow(/no usable source URL/i);
  });
});

describe("not inventing data", () => {
  it("leaves cost unknown rather than assuming free", () => {
    const candidate = normalizeIcsEvent(icsEvent("basic-001"), options);
    // The feed said nothing about cost. null means unknown, not free.
    expect(candidate.isFree).toBeNull();
    expect(candidate.costText).toBeNull();
  });

  it("does not split a free-text location into a fabricated address", () => {
    const candidate = normalizeIcsEvent(icsEvent("basic-001"), options);
    expect(candidate.venueName).toBe("Rice Hall 130");
    expect(candidate.venueAddress).toBeNull();
  });

  it("keeps a null end time rather than inventing a duration", () => {
    expect(normalizeIcsEvent(icsEvent("noend-005"), options).endsAt).toBeNull();
  });

  it("keeps the source's own category wording unmapped", () => {
    const candidate = normalizeIcsEvent(icsEvent("basic-001"), options);
    expect(candidate.categoryRaw).toBe("Lecture");
    expect(candidate.tags).toEqual(["Lecture", "Science"]);
  });
});

describe("content hash", () => {
  it("is stable for identical input", () => {
    const a = normalizeIcsEvent(icsEvent("basic-001"), options);
    const b = normalizeIcsEvent(icsEvent("basic-001"), options);
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("changes when a user-visible field changes", () => {
    const base = icsEvent("basic-001");
    const a = normalizeIcsEvent(base, options);
    const b = normalizeIcsEvent({ ...base, summary: "Different title" }, options);
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it("ignores a bumped publish timestamp", () => {
    // A source that republishes identical content with a fresh DTSTAMP must
    // not look like it changed — otherwise the freshness signal is noise.
    const base = icsEvent("basic-001");
    const a = normalizeIcsEvent(base, options);
    const b = normalizeIcsEvent(
      { ...base, lastModified: new Date("2030-01-01T00:00:00Z") },
      options,
    );
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("changes when the start time moves", () => {
    const base = icsEvent("basic-001");
    const a = normalizeIcsEvent(base, options);
    const b = normalizeIcsEvent(
      { ...base, start: { ...base.start, at: new Date("2030-05-05T12:00:00Z") } },
      options,
    );
    expect(a.contentHash).not.toBe(b.contentHash);
  });
});

describe("normalizeOrganizationName", () => {
  it("collapses case and punctuation into a stable key", () => {
    expect(normalizeOrganizationName("UVA Department of Computer Science")).toBe(
      "uva-department-of-computer-science",
    );
    expect(normalizeOrganizationName("  Spaced   Out!  ")).toBe("spaced-out");
  });

  it("gives the same key for cosmetic differences", () => {
    expect(normalizeOrganizationName("McIntire School")).toBe(
      normalizeOrganizationName("mcintire school"),
    );
  });
});
