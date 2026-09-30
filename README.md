# StealthERP

StealthERP is organized as independent `frontend` and `backend` Node.js
workspaces with a single shared API contract.

## Repository layout

- `frontend/` — Next.js client workspace.
- `backend/` — server workspace.
- `shared/api-contract.ts` — the cross-workspace API contract.
- `scripts/check-repository.sh` — architecture and secret-file guardrails.

## Local validation

Use an active Node.js LTS release (Node.js 20 or newer). Install workspace dependencies deterministically and run the
same checks used by CI:

```sh
./scripts/check-repository.sh
(cd backend && npm ci && npm run format:check)
(cd frontend && npm ci && npm run format:check)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the pull-request workflow and
[SECURITY.md](SECURITY.md) for private vulnerability reporting.
