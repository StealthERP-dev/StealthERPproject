# Contributing

1. Create a short-lived branch from the current `dev` branch.
2. Keep secrets in local `.env` files and mirror key names with blank values in
   the relevant `.env.example` file.
3. Run `./scripts/check-repository.sh` and each changed workspace's
   `npm run format:check` before opening a pull request.
4. Use a pull request; do not push directly to protected branches. Require the
   CI, CodeQL, and dependency-review checks plus at least one reviewer.
5. Prefer small changes, explain operational risk, and include a rollback plan.

Dependency installs must use `npm ci` in automation. Commit lockfile changes and
review dependency updates before merging them.
