import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

// Generate Supabase types and write them as UTF-8 (no BOM, newlines preserved).
// The shell only runs the CLI; Node performs the file write, so the shell `>`
// redirect encoding quirks that previously corrupted database.ts (a UTF-8 BOM
// plus stripped newlines that tsc could not parse) cannot recur.
//
// Source of truth is supabase/migrations + the linked project's live schema;
// this output is a regenerable artifact. Scope is `--schema public` only —
// nothing in the app references the graphql_public schema (verified 2026-05-21).
//
// TARGET RESOLUTION (environment separation, 2026-07-21): the project id comes
// from the CLI link (supabase/.temp/project-ref) — staging by default, per
// CLAUDE.md "Environment separation". Migrations land on staging first, so
// types must generate from staging; prod reaches the same schema at deploy.
// The resolved target is printed on every run so the operator always knows
// where the types came from.
const PROD_REF = "azjllcsffixswiigjqhj";
const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
if (!/^[a-z0-9]{20}$/.test(ref)) {
  throw new Error(`supabase/.temp/project-ref is missing or malformed ("${ref}") — run supabase link first`);
}
const env = ref === PROD_REF ? "PRODUCTION" : "staging";
console.log(`Generating types from ${env} (${ref}) — resolved from supabase/.temp/project-ref.`);
if (ref === PROD_REF) {
  console.warn("WARNING: the repo is linked to PRODUCTION — the default link should be staging.");
}

const out = execSync(
  `npx --yes supabase gen types typescript --project-id ${ref} --schema public`,
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

writeFileSync("src/types/database.ts", out, "utf8");
console.log(`Wrote src/types/database.ts (${out.length} chars).`);
