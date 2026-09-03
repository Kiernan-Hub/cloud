// Integration tests need a real Postgres. Locally that's `docker compose up`;
// in CI it's a service container. Defaults match docker-compose.yml so tests
// run with no extra setup.

process.env.DATABASE_URL ??=
  "postgresql://hoosradar:hoosradar_dev@localhost:5432/hoosradar";
process.env.LOG_LEVEL ??= "error";
