#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ ! -e package.json && ! -e package-lock.json ]] || fail "Node package files must remain in their workspace directories."
[[ -f frontend/.env.example ]] || fail "frontend/.env.example is required."
[[ ! -e backend ]] || fail "A standalone backend workspace is not part of the approved architecture."

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

for workspace in frontend; do
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
