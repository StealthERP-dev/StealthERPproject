# StealthERP

Monorepo root.

- [`frontend/`](frontend/) — the Neighbourhood Store App (Next.js + Supabase). See [frontend/README.md](frontend/README.md) for setup, environment variables, and the Supabase recreate/recovery procedures.
- [`backend/`](backend/) — reserved for a future standalone backend service. Not in use yet: this app talks to Supabase directly from the browser.
- [`shared/`](shared/) — the single-file Zod API contract ([shared/api-contract.ts](shared/api-contract.ts)), imported by the frontend as `@shared/api-contract`, ready for a future backend to import too.
