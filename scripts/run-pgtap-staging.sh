#!/usr/bin/env bash
# ============================================================================
# run-pgtap-staging.sh — run the full pgTAP suite against the STAGING project
# ============================================================================
# Companion to docs/runbooks/use-the-staging-project.md. Never touches prod:
# it routes every call through a throwaway --workdir whose project-ref is the
# staging ref read from .env.local (STAGING_PROJECT_REF). The repo's own
# supabase/.temp (linked to prod) is never modified.
#
# Why the workdir indirection: `supabase db query --db-url` uses the extended
# protocol and rejects multi-statement files ("cannot insert multiple commands
# into a prepared statement"), so test files can only run via the Management
# API (`--linked`), which resolves its target from <workdir>/supabase/.temp/
# project-ref. Verified 2026-07-03 (CLI v2.90.0).
#
# Old-pattern tests (01-08, 14 — pre-`_tap` buffer): the runner returns only
# the LAST row-producing statement, so their per-assertion TAP lines are
# invisible. For those, a throwaway copy replaces `SELECT * FROM finish();`
# with one row of num_failed() + finish() diagnostics — failed=0 and no
# diagnostics proves the whole file. `_tap`-pattern tests (09+) run verbatim
# and are gated on zero `not ok` lines + ok-count == plan(N).
#
# Usage (Git Bash, or from PowerShell as `bash scripts/run-pgtap-staging.sh`):
#   bash scripts/run-pgtap-staging.sh            # run/resume the suite
#   bash scripts/run-pgtap-staging.sh --fresh    # discard prior results first
#
# Results: one verdict line per file in the results path printed at the end.
# Idempotent/resumable: files already in the results are skipped, so an
# interrupted run continues where it stopped.
# ============================================================================
set -u
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TESTS="$REPO_DIR/supabase/tests/database"
ENV_FILE="$REPO_DIR/.env.local"

REF=$(grep '^STAGING_PROJECT_REF=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r')
if [ -z "$REF" ]; then
  echo "ERROR: STAGING_PROJECT_REF not found in .env.local — see docs/runbooks/use-the-staging-project.md" >&2
  exit 1
fi

SWD="${TMPDIR:-/tmp}/odyssey-staging-workdir"
COPIES="$SWD/tap-copies"
RESULTS="$SWD/tap-results.txt"
mkdir -p "$SWD/supabase/.temp" "$COPIES"
printf '%s' "$REF" > "$SWD/supabase/.temp/project-ref"
cp "$REPO_DIR/supabase/config.toml" "$SWD/supabase/config.toml"

[ "${1:-}" = "--fresh" ] && rm -f "$RESULTS" "$RESULTS.failures"
touch "$RESULTS"

run_sql_file() { # $1 = absolute path to .sql file
  supabase db query --workdir "$SWD" --linked -f "$1" -o json 2>&1
}

# Re-establish the canonical helper posture first (00_test_helpers.sql header:
# re-running it re-establishes the full posture; revoke-sweep migrations such
# as 20260612160100 strip the spoofers' authenticated EXECUTE grant, which the
# suite needs). Idempotent, so run it every time.
echo "Applying 00_test_helpers.sql (canonical helper posture)..."
helpers_out=$(run_sql_file "$TESTS/00_test_helpers.sql")
if echo "$helpers_out" | grep -qiE '(^|[^_])error'; then
  echo "ERROR applying test helpers:" >&2
  echo "$helpers_out" | tail -5 >&2
  exit 1
fi

OLD=" 01 02 03 04 05 06 07 08 14 "

for f in "$TESTS"/[0-9]*.sql; do
  base=$(basename "$f")
  num=${base%%_*}
  [ "$num" = "00" ] && continue
  grep -q "^$base " "$RESULTS" && continue

  planned=$(grep -oE 'plan\([0-9]+\)' "$f" | head -1 | grep -oE '[0-9]+' || true)

  if echo "$OLD" | grep -q " $num "; then
    cp="$COPIES/$base"
    sed "s/SELECT \* FROM finish();/SELECT num_failed() AS failed, (SELECT string_agg(fr, ' | ') FROM finish() fr) AS finish_diag;/" "$f" > "$cp"
    out=$(run_sql_file "$cp")
    failed=$(echo "$out" | grep -oE '"failed": *[0-9]+' | grep -oE '[0-9]+' | head -1 || true)
    diag=$(echo "$out" | grep -oE '"finish_diag": *"[^"]*"' | head -1 || true)
    if [ "${failed:-x}" = "0" ] && [ -z "$diag" ]; then
      echo "$base PASS old-pattern num_failed=0 planned=$planned" >> "$RESULTS"
    else
      echo "$base FAIL old-pattern num_failed=${failed:-parse-error} diag=${diag:-none}" >> "$RESULTS"
      { echo "----- $base raw output -----"; echo "$out"; } >> "$RESULTS.failures"
    fi
  else
    out=$(run_sql_file "$f")
    notok=$(echo "$out" | grep -c '"line": "not ok' || true)
    okc=$(echo "$out" | grep -c '"line": "ok ' || true)
    if [ "$notok" = "0" ] && [ -n "$okc" ] && [ "$okc" -gt 0 ] && { [ -z "$planned" ] || [ "$okc" = "$planned" ]; }; then
      echo "$base PASS ok=$okc planned=${planned:-n/a}" >> "$RESULTS"
    else
      echo "$base FAIL ok=$okc not_ok=$notok planned=${planned:-n/a}" >> "$RESULTS"
      { echo "----- $base raw output -----"; echo "$out"; } >> "$RESULTS.failures"
    fi
  fi
  tail -1 "$RESULTS"
done

echo ""
echo "SUITE COMPLETE: $(grep -c ' PASS ' "$RESULTS") pass / $(grep -c ' FAIL ' "$RESULTS") fail of $(grep -cE '^[0-9]' "$RESULTS") files"
echo "Results: $RESULTS"
[ -f "$RESULTS.failures" ] && echo "Failure detail: $RESULTS.failures"
grep ' FAIL ' "$RESULTS" && exit 1 || exit 0
