# 0001: Application platform and delivery model

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

The application needs a clear ownership boundary for frontend, managed backend
capabilities, versioned infrastructure changes, and deployments. It also needs
environment isolation without adding an unvalidated server tier.

## Decision

- The frontend is React using Next.js and is deployed by Vercel.
- Supabase provides PostgreSQL, Auth, Storage, Realtime, and Edge Functions
  where required.
- Database schema, row-level security policies, database functions, and
  Supabase configuration are represented in version control through Supabase
  migrations and project files.
- No standalone Node.js backend will exist until a validated technical
  requirement needs one. Such a requirement requires a subsequent architecture
  decision.
- Short-lived branches are created from `dev`. Pull requests receive isolated
  preview environments, `dev` maps to the shared development/integration
  environment, and `main` maps to production. Changes reach production by
  promotion from `dev` to `main` through a pull request.
- Production data must never be copied to preview or development environments.
- GitHub Actions validates the code. Vercel and Supabase perform deployments
  for the resources they own.

## Consequences

- Application backend capabilities stay within Supabase unless evidence
  justifies another service.
- Supabase changes are reviewable and reproducible rather than being maintained
  only through dashboard edits.
- Environments use separate data; preview and development data must be created
  independently of production data.
- CI validates deployable changes but does not act as the deployment platform.
