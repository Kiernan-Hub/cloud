import sanitizeHtml from "sanitize-html";

/**
 * ADR-0002: allowlist for imported event descriptions. Sanitize on write,
 * never at render time — every read path is then safe by construction.
 * Do not loosen this without updating that decision record and its hostile
 * fixture set.
 */
const ALLOWED_TAGS = ["p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "a", "h3", "h4"];

export function sanitizeEventDescription(rawHtml: string): string {
  return sanitizeHtml(rawHtml, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      // rel/target are not in the source's own markup — they are added by
      // the transform below, and must still be allowlisted or the attribute
      // filter (which runs after the transform) strips them back out.
      a: ["href", "rel", "target"],
    },
    allowedSchemes: ["http", "https"],
    // Imported headings are demoted so they can never outrank page headings,
    // and surviving links get a safe rel/target — both per ADR-0002.
    transformTags: {
      h1: "h4",
      h2: "h4",
      h5: "h4",
      h6: "h4",
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noopener noreferrer nofollow",
        target: "_blank",
      }),
    },
    exclusiveFilter: (frame) => frame.tag === "a" && !frame.attribs.href,
  });
}
