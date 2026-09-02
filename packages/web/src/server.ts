import { config } from "dotenv";

// server.ts is the process entry point (unlike app.ts, which app.test.ts
// imports directly with its own env already set) — .env only gets loaded
// here, and must happen before buildApp() calls getPool().
config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

const { buildApp } = await import("./app.js");

const port = Number(process.env.PORT ?? 3000);
const app = buildApp();

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    app.log.info(`HoosRadar web listening on port ${port}`);
  })
  .catch((error: unknown) => {
    app.log.error(error);
    process.exit(1);
  });
