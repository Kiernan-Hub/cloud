import { describe, expect, it } from "vitest";
import { sanitizeEventDescription } from "./sanitize.js";

// ADR-0002's hostile fixture set, applied literally. Each asserts the actual
// sanitized output, not merely that no exception was thrown.
describe("sanitizeEventDescription", () => {
  it("strips script tags entirely, including their text content", () => {
    expect(sanitizeEventDescription("<script>alert(1)</script>")).toBe("");
  });

  it("strips event-handler attributes, keeping no attribute at all on img", () => {
    // img is not on the allowlist at all — ADR-0002: no images in
    // descriptions for the MVP, to avoid leaking visitor IPs via hot-linking.
    expect(sanitizeEventDescription("<img src=x onerror=alert(1)>")).toBe("");
  });

  it("rejects a javascript: href", () => {
    const out = sanitizeEventDescription('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("href=");
  });

  it("rejects javascript: hrefs with case and whitespace obfuscation", () => {
    const variants = [
      '<a href="JaVaScRiPt:alert(1)">x</a>',
      '<a href="java&#115;cript:alert(1)">x</a>',
      '<a href="&#x6A;avascript:alert(1)">x</a>',
    ];
    for (const html of variants) {
      const out = sanitizeEventDescription(html);
      expect(out.toLowerCase()).not.toContain("javascript:");
    }
  });

  it("rejects a data: href", () => {
    const out = sanitizeEventDescription(
      '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">click</a>',
    );
    expect(out).not.toContain("data:");
    expect(out).not.toContain("href=");
  });

  it("strips iframe, object, embed, and svg with an event handler", () => {
    const html =
      '<iframe src="https://evil.example"></iframe>' +
      '<object data="https://evil.example"></object>' +
      '<embed src="https://evil.example">' +
      '<svg onload="alert(1)"></svg>';
    const out = sanitizeEventDescription(html);
    expect(out).not.toMatch(/<iframe|<object|<embed|<svg/i);
    expect(out).not.toContain("onload");
  });

  it("strips a layout-escaping inline style", () => {
    const out = sanitizeEventDescription('<div style="position:fixed;inset:0">hi</div>');
    expect(out).not.toContain("style=");
    expect(out).not.toContain("position:fixed");
    // div itself is not allowlisted either — only its text should survive.
    expect(out).toContain("hi");
  });

  it("recovers safely from malformed, unclosed markup", () => {
    const out = sanitizeEventDescription("<p>Welcome<script>alert(1)</p>");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
  });

  it("keeps allowlisted structure and a safe http(s) link", () => {
    const out = sanitizeEventDescription(
      "<p>Join us for <strong>trivia night</strong>.</p>" +
        '<a href="https://hoosinvolved.virginia.edu/event/1">details</a>',
    );
    expect(out).toContain("<p>");
    expect(out).toContain("<strong>trivia night</strong>");
    expect(out).toContain('href="https://hoosinvolved.virginia.edu/event/1"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });

  it("demotes source headings so they cannot outrank page headings", () => {
    const out = sanitizeEventDescription("<h1>Big Announcement</h1>");
    expect(out).not.toContain("<h1");
    expect(out).toContain("<h4>Big Announcement</h4>");
  });
});
