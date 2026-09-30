#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ ! -e package.json && ! -e package-lock.json ]] || fail "Node package files must remain in their workspace directories."
[[ -f backend/.env.example ]] || fail "backend/.env.example is required."
[[ -f frontend/.env.example ]] || fail "frontend/.env.example is required."

mapfile -t shared_files < <(find shared -mindepth 1 -maxdepth 1 -type f -printf '%f\n' | sort)
[[ "${#shared_files[@]}" -eq 1 && "${shared_files[0]}" == "api-contract.ts" ]] || \
  fail "shared/ must contain only api-contract.ts."

if git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '(^|/)\.env\.example$' >/dev/null; then
  fail "A non-example environment file is tracked by Git."
fi

for workspace in backend frontend; do
  node -e 'const p=require(`./${process.argv[1]}/package.json`); if (p.private !== true) throw new Error(`${process.argv[1]} must be private`)' "$workspace"
  [[ -f "$workspace/package-lock.json" ]] || fail "$workspace/package-lock.json is required for reproducible installs."

  if [[ -f "$workspace/.env" ]]; then
    missing_keys="$(comm -23 \
      <(awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/{print $1}' "$workspace/.env" | sort -u) \
      <(awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/{print $1}' "$workspace/.env.example" | sort -u))"
    [[ -z "$missing_keys" ]] || fail "$workspace/.env.example is missing keys from the local .env: ${missing_keys//$'\n'/, }."
  fi
done

echo "Repository guardrails passed."
