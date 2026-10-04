# StealthERP

StealthERP is a React application built with Next.js. Vercel hosts the
frontend, while Supabase supplies PostgreSQL, Auth, Storage, Realtime, and Edge
Functions where they are needed. There is no standalone Node.js backend.

## Repository layout

- `frontend/` — the Next.js application deployed by Vercel.
- `supabase/` — the location for version-controlled Supabase project
  configuration and migrations as database and backend capabilities are added.
- `shared/api-contract.ts` — the required regular file for shared contract
  definitions.
- `shared/api-contract/` — an optional directory layout for contract modules.
  When present, it must contain the `entities/`, `dto/`, and `rpc/` directories.
  It may also contain the optional regular files `auth.ts`, `enums.ts`,
  `primitives.ts`, and `index.ts`. No other entries are allowed at this level.
- `scripts/check-repository.sh` — architecture and secret-file guardrails.

The `shared/` directory may contain only `api-contract.ts` and the optional
`api-contract/` directory. Symlinks are not allowed anywhere under `shared/`.

## Delivery model

Work is developed on short-lived branches from `dev`. Pull requests and `dev`
use isolated preview/development environments; `main` is the production branch
and deploys to production. Production data must never be copied into a preview
or development environment.

GitHub Actions validates changes. Vercel deploys the frontend, and Supabase
deploys its managed resources and version-controlled project changes.

See the [accepted architecture decision](docs/architecture/decisions/0001-application-platform-and-delivery.md)
for the rationale and constraints.

## Local validation

Use an active Node.js LTS release (Node.js 20 or newer). Install frontend
dependencies deterministically and run the same checks used by CI:

```sh
./scripts/check-repository.sh
(cd frontend && npm ci && npm run format:check)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the pull-request workflow and
[SECURITY.md](SECURITY.md) for private vulnerability reporting.
