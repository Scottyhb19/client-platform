import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Git-ignored, non-shipping code that should not be linted:
    // transient Claude Code worktrees and design-reference prototypes.
    ".claude/**",
    ".design-ref/**",
  ]),
  {
    // Honour the `_`-prefix convention for intentionally-unused bindings
    // (e.g. signature params kept for documentation/future variants). The
    // rule stays full-strength for genuinely dead code — only names that
    // explicitly opt out with a leading underscore are ignored. Severity
    // matches eslint-config-next ('warn').
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
