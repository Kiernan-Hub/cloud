// Per-source parsers. One directory per source.
//
// A parser takes bytes and returns a plain object. It must not import
// storage, dedup, search, or the database client — enforced by lint rules in
// eslint.config.mjs. See docs/adr/0005-module-boundaries.md.
export {};
