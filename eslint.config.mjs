import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier";

// Module boundary rules from docs/adr/0005-module-boundaries.md.
// Enforced with no-restricted-imports rather than a workspace/package split —
// see the ADR for why. Deep imports into another module's internals (i.e.
// anything but its index.ts) are blocked everywhere via the shared pattern.
const noDeepModuleImports = {
  group: ["@/modules/*/*", "!@/modules/*/index"],
  message:
    "Import from a module's index.ts, not its internals. See docs/adr/0005-module-boundaries.md.",
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
    // Parsers take bytes, return plain objects. They must not be able to
    // reach storage, dedup, search, or the database client — this is the
    // load-bearing rule that keeps a bad source from corrupting data and
    // keeps parser tests fixture-only.
    files: ["src/modules/parsing/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            noDeepModuleImports,
            {
              group: [
                "@/modules/events",
                "@/modules/events/*",
                "@/modules/dedup",
                "@/modules/dedup/*",
                "@/modules/search",
                "@/modules/search/*",
                "@/lib/db",
                "@/lib/db/*",
              ],
              message:
                "parsing/ must not import storage or persistence. See docs/adr/0005-module-boundaries.md.",
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
              group: [
                "@/modules/parsing",
                "@/modules/parsing/*",
                "@/modules/ingestion/*",
              ],
              message:
                "app/ must not import parsing/ or ingestion/ internals. See docs/adr/0005-module-boundaries.md.",
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
                "lib/ must not import from modules/. Dependencies point one way. See docs/adr/0005-module-boundaries.md.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
