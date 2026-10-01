# StealthERP

StealthERP is organized as independent `frontend` and `backend` Node.js
workspaces with a shared API contract.

## Repository layout

- `frontend/` — Next.js client workspace.
- `backend/` — server workspace.
- `shared/api-contract.ts` — the required regular file containing the
	cross-workspace API contract.
- `shared/api-contract/` — an optional directory layout for contract modules.
	When present, it must contain the `entities/`, `dto/`, and `rpc/` directories.
	It may also contain the optional regular files `auth.ts`, `enums.ts`,
	`primitives.ts`, and `index.ts`. No other entries are allowed at this level.
- `scripts/check-repository.sh` — architecture and secret-file guardrails.

The `shared/` directory may contain only `api-contract.ts` and the optional
`api-contract/` directory. Symlinks are not allowed anywhere under `shared/`.

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
