import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier";

// Module boundary rules from docs/adr/0002-module-boundaries.md.
// Enforced with no-restricted-imports rather than a workspace/package split —
// see the ADR for why. Deep imports into another module's internals (i.e.
// anything but its index.ts) are blocked everywhere via the shared pattern.
const noDeepModuleImports = {
  group: ["@/modules/*/*", "!@/modules/*/index"],
  message:
    "Import from a module's index.ts, not its internals. See docs/adr/0002-module-boundaries.md.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettierConfig,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [noDeepModuleImports] }],
    },
  },
  {
    // The runner executes commands and reports results. It must not be able
    // to reach storage — that keeps it testable against real subprocesses
    // with no database, and keeps "what happened" separate from "what we
    // recorded about it".
    files: ["src/modules/runner/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            noDeepModuleImports,
            {
              group: [
                "@/modules/runs",
                "@/modules/runs/*",
                "@/modules/projects",
                "@/modules/projects/*",
                "@/modules/analysis",
                "@/modules/analysis/*",
                "@/lib/db",
                "@/lib/db/*",
              ],
              message:
                "runner/ must not import storage or persistence. See docs/adr/0002-module-boundaries.md.",
            },
          ],
        },
      ],
    },
  },
  {
    // The web layer reads through events/, search/, and admin/ — not
    // ingestion internals or raw parsers.
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            noDeepModuleImports,
            {
              group: ["@/modules/runner", "@/modules/runner/*"],
              message:
                "app/ must not execute gates. Read results through runs/ and analysis/. See docs/adr/0002-module-boundaries.md.",
            },
          ],
        },
      ],
    },
  },
  {
    // lib/ is a leaf: cross-cutting utilities that modules depend on, never
    // the reverse.
    files: ["src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            noDeepModuleImports,
            {
              group: ["@/modules", "@/modules/*"],
              message:
                "lib/ must not import from modules/. Dependencies point one way. See docs/adr/0002-module-boundaries.md.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
