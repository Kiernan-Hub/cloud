import { describe, expect, it } from "vitest";
import { contentFingerprintOf } from "./fingerprint.js";

describe("contentFingerprintOf", () => {
  const base = {
    title: "Chai Chats & Crafts",
    startAt: new Date("2026-09-02T18:00:00Z"),
    venueName: "Asian American Student Center",
    organizationName: "Multicultural Student Services",
  };

  it("is stable for the same event", () => {
    expect(contentFingerprintOf(base)).toBe(contentFingerprintOf({ ...base }));
  });

  it("is insensitive to title casing and surrounding whitespace", () => {
    const reformatted = { ...base, title: "  CHAI chats & crafts  " };
    expect(contentFingerprintOf(reformatted)).toBe(contentFingerprintOf(base));
  });

  it("changes when the start time changes", () => {
    const rescheduled = { ...base, startAt: new Date("2026-09-02T19:00:00Z") };
    expect(contentFingerprintOf(rescheduled)).not.toBe(contentFingerprintOf(base));
  });

  it("is unaffected by fields a source commonly reformats", () => {
    // ADR-0001 section 4: description and url are deliberately excluded from
    // the fingerprint, because sources reformat descriptions and add
    // tracking parameters to urls between imports. The function's parameter
    // type has no field for either, so passing them is a type error — this
    // test is the regression guard: it fails loudly if the signature is ever
    // widened to accept one. Building the object in a variable first (rather
    // than passing an inline literal) sidesteps TypeScript's excess-property
    // check, so this compiles precisely because the extra fields are ignored
    // rather than rejected — that's what's under test.
    const candidateWithExtraFields = {
      ...base,
      description: "This paragraph was reworded by the source between runs.",
      url: "https://example.com/event/1?utm_source=newsletter",
    };
    expect(contentFingerprintOf(candidateWithExtraFields)).toBe(contentFingerprintOf(base));
  });
});
