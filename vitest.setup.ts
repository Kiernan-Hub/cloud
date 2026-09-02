import { config } from "dotenv";

// Tests must never run against the same database as local dev — a test
// creating and deleting rows would otherwise pollute the events an actual
// `npm run dev:web` session is showing (this happened once while building
// the skeleton: leftover test rows briefly appeared as real events on the
// homepage). .env.test points at a separate hoosradar_test database; CI sets
// DATABASE_URL directly instead, so a missing .env.test there is expected.
config({ path: new URL("./.env.test", import.meta.url).pathname, quiet: true });
