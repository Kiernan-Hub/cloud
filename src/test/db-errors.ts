import { expect } from "vitest";

// Drizzle wraps driver errors, so the useful detail (which constraint fired,
// and the SQLSTATE code) lives on `cause` rather than in the message. Asserting
// on the constraint name is stricter than a message regex — it fails if a
// different constraint rejects the row for an unrelated reason.

type PgErrorCause = {
  constraint_name?: string;
  code?: string;
  message?: string;
};

function causeOf(error: unknown): PgErrorCause {
  const cause = (error as { cause?: unknown })?.cause;
  return (cause ?? {}) as PgErrorCause;
}

export async function expectConstraintViolation(
  operation: Promise<unknown>,
  constraintName: string,
): Promise<void> {
  let thrown: unknown;
  try {
    await operation;
  } catch (error) {
    thrown = error;
  }

  expect(
    thrown,
    `expected ${constraintName} to reject the operation, but it succeeded`,
  ).toBeDefined();
  expect(causeOf(thrown).constraint_name).toBe(constraintName);
}
