#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ -f package.json && -f package-lock.json ]] || fail "Root package files are required for reproducible Supabase CLI installation."
[[ -f frontend/.env.example ]] || fail "frontend/.env.example is required."
[[ ! -e backend ]] || fail "A standalone backend workspace is not part of the approved architecture."

for path in supabase supabase/migrations supabase/tests supabase/functions; do
  [[ -d "$path" && ! -L "$path" ]] || fail "$path must be a directory, not a symbolic link."
done

for path in supabase/config.toml supabase/seed.sql supabase/.gitignore; do
  [[ -f "$path" && ! -L "$path" ]] || fail "$path must be a regular file, not a symbolic link."
done

supabase_symlink="$(find supabase -type l -print -quit)"
[[ -z "$supabase_symlink" ]] || fail "Symbolic links are not allowed under supabase/: ${supabase_symlink}."

node - <<'NODE'
const packageJson = require("./package.json");
if (packageJson.private !== true) throw new Error("Root tooling package must be private");
if (packageJson.devDependencies?.supabase !== "2.119.0") {
  throw new Error("Supabase CLI must remain pinned to version 2.119.0");
}
if (packageJson.scripts?.supabase !== "supabase") {
  throw new Error("The reproducible Supabase CLI script is required");
}
NODE

grep -Eq '^project_id = "stealth-erp-local"$' supabase/config.toml || \
  fail "supabase/config.toml must use the non-production local project identifier."

[[ -d shared && ! -L shared ]] || fail "shared/ must be a directory."
shared_symlink="$(find shared -type l -print -quit)"
[[ -z "$shared_symlink" ]] || fail "Symbolic links are not allowed under shared/: ${shared_symlink}."
[[ -f shared/api-contract.ts && ! -L shared/api-contract.ts ]] || \
  fail "shared/api-contract.ts must be a regular file."

mapfile -d '' -t shared_entries < <(find shared -mindepth 1 -maxdepth 1 -print0)
for entry in "${shared_entries[@]}"; do
  case "${entry#shared/}" in
    api-contract.ts)
      [[ -f "$entry" && ! -L "$entry" ]] || fail "$entry must be a regular file."
      ;;
    api-contract)
      [[ -d "$entry" && ! -L "$entry" ]] || fail "$entry must be a directory."
      ;;
    *)
      fail "Unexpected entry under shared/: ${entry#shared/}."
      ;;
  esac
done

if [[ -d shared/api-contract ]]; then
  for directory in entities dto rpc; do
    [[ -d "shared/api-contract/$directory" && ! -L "shared/api-contract/$directory" ]] || \
      fail "shared/api-contract/$directory must be a directory."
  done

  mapfile -d '' -t contract_entries < <(find shared/api-contract -mindepth 1 -maxdepth 1 -print0)
  for entry in "${contract_entries[@]}"; do
    case "${entry#shared/api-contract/}" in
      entities|dto|rpc)
        [[ -d "$entry" && ! -L "$entry" ]] || fail "$entry must be a directory."
        ;;
      auth.ts|enums.ts|primitives.ts|index.ts)
        [[ -f "$entry" && ! -L "$entry" ]] || fail "$entry must be a regular file."
        ;;
      *)
        fail "Unexpected entry under shared/api-contract/: ${entry#shared/api-contract/}."
        ;;
    esac
  done
fi

if git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '(^|/)\.env\.example$' >/dev/null; then
  fail "A non-example environment file is tracked by Git."
fi

for workspace in . frontend; do
  node -e 'const p=require(`./${process.argv[1]}/package.json`); if (p.private !== true) throw new Error(`${process.argv[1]} must be private`)' "$workspace"
  [[ -f "$workspace/package-lock.json" ]] || fail "$workspace/package-lock.json is required for reproducible installs."

  if [[ -f "$workspace/.env" ]]; then
    missing_keys="$(comm -23 \
      <(awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/{print $1}' "$workspace/.env" | sort -u) \
      <(awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/{print $1}' "$workspace/.env.example" | sort -u))"
    [[ -z "$missing_keys" ]] || fail "$workspace/.env.example is missing keys from the local .env: ${missing_keys//$'\n'/, }."
  fi
done

if [[ -f frontend/.env ]]; then
  missing_keys="$(comm -23 \
    <(awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/{print $1}' frontend/.env | sort -u) \
    <(awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/{print $1}' frontend/.env.example | sort -u))"
  [[ -z "$missing_keys" ]] || fail "frontend/.env.example is missing keys from frontend/.env: ${missing_keys//$'\n'/, }."
fi

echo "Repository guardrails passed."
