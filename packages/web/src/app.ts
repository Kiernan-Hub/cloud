import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import { getEventById, getPool, listUpcomingEvents, searchEvents } from "@hoosradar/db";
import { Eta } from "eta";
import Fastify, { type FastifyInstance } from "fastify";
import { formatEventWhen, formatLastChecked } from "./format.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds the Fastify app without starting a listener, so it can be exercised
 * directly with `.inject()` in tests — see routes.test.ts.
 */
export function buildApp(): FastifyInstance {
  const nodeEnv = process.env.NODE_ENV;
  const logger =
    nodeEnv === "test"
      ? false
      : nodeEnv === "production"
        ? true
        : { transport: { target: "pino-pretty" } };
  const app = Fastify({ logger });

  // .eta templates are never compiled by tsc, so this must resolve to
  // packages/web/src/views whether __dirname is src (dev, via tsx) or dist
  // (built, via `node dist/server.js`) — both are one level under
  // packages/web, so "../src/views" reaches the same place from either.
  const eta = new Eta({
    views: path.join(__dirname, "..", "src", "views"),
    cache: process.env.NODE_ENV === "production",
  });

  app.register(fastifyStatic, {
    root: path.join(__dirname, "..", "public"),
    prefix: "/static/",
  });

  const pool = getPool();

  // Health check distinguishes the web process from source health, per
  // OVERVIEW.md section 7 — it says nothing about ingestion or any source.
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/", async (request, reply) => {
    const cursor =
      typeof request.query === "object" && request.query && "cursor" in request.query
        ? String((request.query as Record<string, unknown>).cursor ?? "")
        : "";
    const page = await listUpcomingEvents(pool, { cursor: cursor || null });

    const html = eta.render("index", {
      events: page.events,
      nextCursor: page.nextCursor,
      formatEventWhen,
      formatLastChecked,
    });
    reply.type("text/html").send(html);
  });

  app.get("/search", async (request, reply) => {
    const q =
      typeof request.query === "object" && request.query && "q" in request.query
        ? String((request.query as Record<string, unknown>).q ?? "").trim()
        : "";
    const events = q ? await searchEvents(pool, q) : [];

    const html = eta.render("search", {
      query: q,
      events,
      formatEventWhen,
      formatLastChecked,
    });
    reply.type("text/html").send(html);
  });

  app.get<{ Params: { id: string } }>("/events/:id", async (request, reply) => {
    const event = await getEventById(pool, request.params.id);
    if (!event) {
      reply.code(404);
      const html = eta.render("not-found", {});
      reply.type("text/html").send(html);
      return;
    }

    const html = eta.render("event", {
      event,
      formatEventWhen,
      formatLastChecked,
    });
    reply.type("text/html").send(html);
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404);
    const html = eta.render("not-found", {});
    reply.type("text/html").send(html);
  });

  return app;
}
