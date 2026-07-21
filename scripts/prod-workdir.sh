#!/usr/bin/env bash
# ============================================================================
# scripts/prod-workdir.sh — build the PRODUCTION workdir (the explicit channel)
# ============================================================================
# Environment separation (2026-07-21): the repo is linked to STAGING, so every
# bare supabase command targets staging. Touching production is an explicit,
# deliberate act — this script builds a throwaway workdir whose .temp points
# at the production ref, for use with `supabase ... --workdir "$PROD_WD"`.
#
# It never touches the repo's own supabase/.temp (the staging linkage), and it
# copies supabase/migrations in so `db push --workdir` can resolve them.
#
# Usage (from the repo root, in Git Bash):
#   source scripts/prod-workdir.sh          # sets $PROD_WD, prints examples
#
# Then, per CLAUDE.md rule 2 (production only on explicit operator
# instruction), e.g.:
#   supabase migration list --workdir "$PROD_WD" --linked
#   supabase db push        --workdir "$PROD_WD" --linked
#   supabase db query       --workdir "$PROD_WD" --linked -f "<ABSOLUTE .sql>"
# ============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROD_REF="$(grep '^PROD_PROJECT_REF=' "$REPO_ROOT/.env.local" | cut -d= -f2- | tr -d '\r')"

if [ -z "$PROD_REF" ]; then
  echo "ERROR: PROD_PROJECT_REF not found in .env.local" >&2
  return 1 2>/dev/null || exit 1
fi

PROD_WD="${TMPDIR:-/tmp}/odyssey-prod-workdir"
mkdir -p "$PROD_WD/supabase/.temp"
printf '%s' "$PROD_REF" > "$PROD_WD/supabase/.temp/project-ref"
cp "$REPO_ROOT/supabase/config.toml" "$PROD_WD/supabase/config.toml"
rm -rf "$PROD_WD/supabase/migrations"
cp -r "$REPO_ROOT/supabase/migrations" "$PROD_WD/supabase/migrations"

echo "PRODUCTION workdir ready: $PROD_WD  (target: $PROD_REF)"
echo "This targets PRODUCTION. Per CLAUDE.md rule 2, use only on explicit operator instruction."
export PROD_WD
