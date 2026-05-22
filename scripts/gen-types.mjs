import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// Generate Supabase types and write them as UTF-8 (no BOM, newlines preserved).
// The shell only runs the CLI; Node performs the file write, so the shell `>`
// redirect encoding quirks that previously corrupted database.ts (a UTF-8 BOM
// plus stripped newlines that tsc could not parse) cannot recur.
//
// Source of truth is supabase/migrations + the live schema; this output is a
// regenerable artifact. Scope is `--schema public` only — nothing in the app
// references the graphql_public schema (verified 2026-05-21).
const out = execSync(
  "npx --yes supabase gen types typescript --project-id azjllcsffixswiigjqhj --schema public",
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

writeFileSync("src/types/database.ts", out, "utf8");
console.log(`Wrote src/types/database.ts (${out.length} chars).`);
