# Contributing

1. Create a short-lived branch from the current `dev` branch.
2. Keep secrets in local `.env` files and mirror key names with blank values in
   the relevant `.env.example` file.
3. Run `nvm use` and `npm ci`, then use the root scripts to run repository
   validation, formatting, linting, type checking, tests, and the production
   build before opening a pull request.
4. Use a pull request; do not push directly to protected branches. Require the
   CI, CodeQL, and dependency-review checks plus at least one reviewer.
5. Prefer small changes, explain operational risk, and include a rollback plan.

Dependency installs must use `npm ci` in automation. Commit lockfile changes and
review dependency updates before merging them.

The root npm package is private and owns the workspace lockfile. Do not create a
workspace-level lockfile. Use `npm run supabase:start` for the local stack and
`npm run supabase:test:db` for database tests. Keep schema changes in
`supabase/migrations/`, database tests in `supabase/tests/`, and Edge Functions
in `supabase/functions/`. Seed data must be synthetic and must not contain
production or personal data.
