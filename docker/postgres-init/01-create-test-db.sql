-- The postgres image's POSTGRES_DB env var only creates one database
-- (hoosradar_dev). Tests must run against a separate database — see
-- vitest.setup.ts for why — so this creates hoosradar_test on first
-- container start, owned by the same POSTGRES_USER.
CREATE DATABASE hoosradar_test;
