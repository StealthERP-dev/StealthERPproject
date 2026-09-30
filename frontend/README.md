# Store App

A mobile-first PWA for small neighbourhood shops. The shopkeeper keeps a live
"what's available today" list, shares the catalogue via a link, and customers
send order requests with no login.

## Prerequisites

- Node 24 (see `frontend/.nvmrc` — use `nvm use` or any Node version manager that
  reads it)
- Docker (used by the local Supabase stack, `check:gitleaks`, and
  `actionlint`)
- npm (the project's chosen package manager)

## Local development

```bash
npm ci
npm run dev:local   # starts the local Supabase stack, writes .env.local, runs the app
```

To run the app on your laptop against the **staging** database instead:

```bash
cp .env.example .env.staging   # once; fill in the staging URL and key
npm run dev:staging
```

`dev:staging` loads `.env.staging` for that run only — its values take
precedence over `.env.local`, which stays untouched, so switching back is
just `npm run dev:local`.

Open `http://localhost:3000/store/priya-stores` — this is the seeded demo
vendor's public storefront. The demo vendor account
(`9876543210@phone.local` / PIN `123456`) exists only in the local
`supabase/seed.sql` data and is never applied to a cloud project (see
Database below).

## Environment variables

Only two environment variables exist anywhere in this app — both public.

| Name                            | Purpose                                            | Where set                                                       | Public or secret |
| ------------------------------- | -------------------------------------------------- | --------------------------------------------------------------- | ---------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project API URL                           | `.env.local` (local), Vercel Preview (staging) / Production env | Public           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key, used by the browser-only client | `.env.local` (local), Vercel Preview (staging) / Production env | Public           |

Both values are safe to expose to the browser — Row Level Security on every
table is what actually enforces access, not secrecy of these two variables.
The Supabase **service-role / secret key must never** be placed in
`.env.local`, in Vercel, in CI, or in git — it is used only from the
Supabase dashboard and one-off local CLI commands, never referenced by any
file under `src/`. See `.env.example` for the variable names
(`npm run env:local` generates the real, git-ignored `.env.local`).

## Environments

| Environment | Git branch | Hosted on             | Supabase project         | Where the two env values live               |
| ----------- | ---------- | --------------------- | ------------------------ | ------------------------------------------- |
| Local       | any        | `npm run dev:local`   | local Docker stack       | `.env.local` (written by `dev:local`)       |
| Staging     | `staging`  | Vercel **Preview**    | separate staging project | Vercel → Environment Variables → Preview    |
| Production  | `main`     | Vercel **Production** | production project       | Vercel → Environment Variables → Production |

Staging and production use **different Supabase projects**, so test data
never touches production. On a laptop, the staging values live in the
git-ignored `.env.staging` (template: `.env.example`); the deployed
staging site gets them from Vercel at build time.

### One-time staging setup

1. Create the staging Supabase project and apply the dashboard settings from
   steps 1–2 of "Recreate the Supabase project on another account" below.
2. In Vercel, import the GitHub repo with **Root Directory** set to
   `frontend` (keep "Include files outside the root directory" on — the
   app imports `../shared`). Set **Production Branch** to `main`.
3. In Vercel → Settings → Environment Variables, add the two
   `NEXT_PUBLIC_SUPABASE_*` variables for **Preview** with the staging
   project's URL and anon key, and for **Production** with the production
   project's values. Every non-`main` branch (including pull-request
   previews) then builds against staging.
4. Push the `staging` branch. Vercel gives it a stable URL
   (`<project>-git-staging-<team>.vercel.app`); optionally attach a custom
   domain to the `staging` branch in Settings → Domains.
5. Vercel protects Preview deployments with a login by default. If testers
   must open staging without a Vercel account, turn that off under
   Settings → Deployment Protection.

### Push migrations to staging

Run from `frontend/` whenever `supabase/migrations/` changes, before merging
to `staging`:

```bash
npx supabase login   # once per machine
npm run db:push:staging
```

The script reads the staging project ref from the URL in `.env.staging` and
re-links the CLI to that project on every run, so it can never push to a
previously linked production project by mistake. The CLI asks for the
staging database password and lists the pending migrations before applying
them. It never sends `supabase/seed.sql`.

## Database

- Migrations live in `supabase/migrations/`, one file per concern (schema,
  RLS, `place_order`, storage). They are the single source of truth for the
  schema — never make a change through the Supabase dashboard that isn't
  also captured in a migration.
- `supabase/seed.sql` seeds one deterministic demo shop for **local
  development only** — a `supabase db push` never includes
  `--include-seed`, so this data never reaches a cloud project.
- After any schema change, regenerate and commit the TypeScript types:
  ```bash
  npm run db:types
  ```
  `npm run db:types:check` (used in CI) fails if the committed types have
  drifted from the live local schema.

## Beta data and analytics

The beta needs reliable data to understand vendor and customer behaviour,
not a built dashboard. Every number below is read through the **Supabase
dashboard's SQL editor** — there is no web UI for any of this.

**Written definitions** (agreed before launch, per the beta data
requirements doc §3/§5):

- **Activated vendor** — a vendor who completes setup AND has at least one
  available product AND has at least one catalogue share. (A shared empty
  catalogue is not a live catalogue.) Computed by `private.vendor_activation`
  and rolled up into `private.beta_kpi_summary.vendors_activated`.
- **Active vendor (on a day)** — a vendor who performed at least one
  meaningful action that day: product added/updated, availability flipped,
  offer created, catalogue/product shared, or orders list opened. Merely
  opening the app does not count. Computed by
  `private.vendor_daily_activity` and rolled up into D1/D7/D14/D30 retention
  windows in `private.vendor_retention`.

**Where the numbers live.** Ten views in the non-exposed `private` schema
answer the doc's ten minimum questions. They are deliberately unreachable
from a browser session — `anon` and `authenticated` hold no grant on any of
them, and `private` is not listed in `supabase/config.toml`'s
`[api] schemas` — so the Supabase dashboard's SQL editor (which connects as
`postgres`, a role that owns every schema and bypasses RLS) is the only way
to read them.

| #   | Question                                     | View                                                           | Column(s)                                              |
| --- | -------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| 1   | How many vendors signed up?                  | `private.beta_kpi_summary`                                     | `vendors_registered`                                   |
| 2   | How many completed setup?                    | `private.beta_kpi_summary` / `private.vendor_activation`       | `vendors_setup_completed` / `has_completed_onboarding` |
| 3   | How many published a catalogue?              | `private.vendor_activation`                                    | `has_available_product`                                |
| 4   | How many shared it?                          | `private.vendor_activation` / `private.beta_kpi_summary`       | `has_shared_catalogue` / `catalogues_shared`           |
| 5   | How many customers opened it?                | `private.customer_funnel`                                      | `catalogues_opened`                                    |
| 6   | How many customers viewed products?          | `private.customer_funnel`                                      | `products_viewed`                                      |
| 7   | How many started carts?                      | `private.customer_funnel`                                      | `carts_started`                                        |
| 8   | How many orders were placed?                 | `private.customer_funnel` / `private.order_outcomes`           | `orders_placed` / `orders_new`                         |
| 9   | How many vendors returned and used it again? | `private.vendor_retention` (+ `private.vendor_daily_activity`) | `retained_d1` / `d7` / `d14` / `d30`                   |
| 10  | What changed after each product iteration?   | `private.release_comparison`                                   | one row per `app_version`                              |

Supporting views: `private.event_actors` (normalises `events`' three
nullable identity columns into one `actor_kind`/`actor_key` pair),
`private.customer_retention` (repeat orders per shop), `private.offer_activity`
(offers created/shared per store per day).

**Export and access** (doc §11):

- Every SQL editor result grid in Supabase Studio offers a CSV download
  directly — no extra tooling needed for a one-off export.
- For a scripted export, `psql`'s `\copy (select ...) to 'file.csv' csv
header` produces the same file from a connection string.
- For JSON, wrap the query in `row_to_json` (or `jsonb_agg(row_to_json(t))`
  for a full result set) and copy the output the same way.
- Every export uses unique ids (`store_id`, `customer_id`, …) as the primary
  identifier — never a phone number.

**Backups and recovery** (doc §13):

- The production Supabase project must have automated daily backups enabled
  in the dashboard under **Database → Backups** before real traffic reaches
  it.
- Basic recovery procedure:
  1. Restore the most recent backup into a new project from the dashboard.
  2. If the restore predates a migration, replay `supabase/migrations/`
     against the restored project (`npx supabase db push`, no
     `--include-seed`).
  3. Regenerate and commit the TypeScript types (`npm run db:types`) against
     the restored project.
  4. Repoint `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     (Vercel Production env) at the restored project.
  5. Run `npm run verify:db` against the restored project and confirm it is
     green before sending any traffic to it.

**Development and production separation** (doc §13):

- `supabase/seed.sql` is **local-only**: `supabase db push` is never run
  with `--include-seed`, so the demo shop never reaches a cloud project.
- `npm run db:reset` destroys the local database and must never be pointed
  at a linked production project.
- Test data therefore never touches production — by construction, not by
  discipline.
- **Open dependency:** no cloud Supabase project is linked yet. Plan `01-06`
  (deferred, awaiting accounts) performs the first `supabase db push`, and it
  must run **after** this phase so the cloud project receives all twelve
  migrations — Phase 1's four plus this phase's eight — in one ordered pass.

## Quality gates

| Command                            | What it checks                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify`                   | typecheck, lint, format:check, build, check:secrets, check:icons, check:manifest:self-test                                   |
| `npm run verify:db`                | db reset, types drift, security advisors, pgTAP, HTTP DB tests                                                               |
| `npm run check:secrets`            | decodes every JWT in the built bundle (`.next/static`) and `src/`, flags any non-`anon` role or `sb_secret_` key             |
| `npm run check:secrets:self-test`  | proves `check:secrets` actually detects a planted privileged-role token                                                      |
| `npm run check:gitleaks`           | gitleaks v8.30.1 (official Docker image) over the full git history                                                           |
| `npm run check:manifest`           | the served manifest, its icons, vendor head tags and customer-route absence — run against a started server or a deployed URL |
| `npm run check:manifest:self-test` | proves `check:manifest`'s validators flag every bad fixture and pass the good one, in both directions                        |
| `npm run check:icons`              | the committed icon PNGs match `scripts/generate-app-icons.mjs`'s output byte for byte                                        |

A husky pre-commit hook runs `lint-staged` (ESLint `--max-warnings=0` +
Prettier) on every staged `.ts`/`.tsx`/`.mjs`/`.css`/`.json`/`.md`/`.yml`
file, so a commit with a lint violation cannot land without deliberately
bypassing the hook. GitHub Actions CI (`.github/workflows/ci.yml`) mirrors
every one of these gates on every push, across three jobs — `app`
(typecheck/lint/format/build/secrets), `database` (types/advisors/pgTAP/HTTP
tests against a fresh local Supabase stack), and `secrets` (gitleaks over
full history). No repository secrets are required by any job.

## Recreate the Supabase project on another account

This project is built on the developer's own Supabase account during
development; at handover it must be replayable on the client's account with
nothing but the files in this repo.

1. Create a new Supabase project on the client's account (Postgres 17, same
   region choice as the original).
2. In the dashboard: **Authentication → Providers → Email**, set
   **Confirm email** off and the minimum password length to match
   `supabase/config.toml`'s `[auth.email]` / `[auth]` values (this project
   uses a synthetic `<digits>@phone.local` address and a 6-digit PIN as the
   password, so confirmation email must stay off).
3. Link the CLI to the new project and push every migration:
   ```bash
   npx supabase login
   npx supabase link --project-ref <new-project-ref>
   npx supabase db push
   ```
   Never pass `--include-seed` — `supabase/seed.sql` is local-only demo
   data and must never reach a real client project.
4. Confirm the generated types still match exactly:
   ```bash
   npx supabase gen types typescript --linked --schema public
   ```
   This output must match the committed `src/lib/supabase/database.types.ts`
   byte-for-byte; if it doesn't, the migrations and the committed types have
   drifted and need to be reconciled before continuing.
5. Run the security advisors gate against the linked project:
   ```bash
   node scripts/check-advisors.mjs --linked
   ```
6. In Vercel, set the two `NEXT_PUBLIC_SUPABASE_*` variables (see
   Environment variables above) for both the **Preview** and **Production**
   environments, pointing at the new project's URL and anon key.
7. Confirm no privileged key was ever exposed: `npm run check:secrets`
   against a fresh build, and `npm run check:gitleaks` across history —
   both must stay clean. After deploying, also run
   `node scripts/check-bundle-secrets.mjs --url <production-url>` for each
   route family (`/`, `/login`, `/store/<slug>`) and
   `npm run check:manifest -- <production-url>`.

## Resume a paused free-tier project

A Free Plan Supabase project pauses itself after 7 days of low activity, to
save server resources — confirmed against
[supabase.com/docs/guides/platform/free-project-pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
on 2026-09-28. A project on the Pro plan is never paused for inactivity.

**What the shopkeeper sees while paused:** nothing loads and nothing saves —
not for the shopkeeper, and not for a customer opening the shared link —
until someone with dashboard access resumes the project.

**How to resume it** (restore is possible for up to 1 year after the pause):

1. Open the Supabase Dashboard.
2. Select the organisation, then the paused project.
3. Click **Resume project** and confirm.
4. The project returns with its previous data and configuration intact.

**Keeping it awake.** A shop that opens the app most days already generates
enough activity to avoid pausing (the documented threshold is "a few user
requests to the database each day over the previous week"). The
alternatives are: upgrading the project to the Pro plan, which removes
pausing entirely; or a scheduled keep-alive request, which this repository
does not ship. Which of these to do is the **client's decision**, not one
this project makes for them.

## Reset a vendor's PIN from the dashboard

The obvious-looking buttons in the Supabase dashboard do not work here, for
two reasons. First, the Users panel's "Send password recovery" option
emails a link to the user's on-file address — but every vendor's address is
a synthetic `<digits>@phone.local` that receives no real mail, so that
email goes nowhere. Second, **never use Delete user as a reset**: this
project's `stores.owner_id` is `on delete cascade`, so deleting the auth
user deletes their shop, every product, every offer and every order along
with it. (Plan time checked Supabase Studio's open-source Users panel
source and found no direct "set a new password" control either — re-check
the live dashboard when it exists, and update this section if one has been
added.)

The verified path is the SQL Editor, which sets the password hash directly
and clears any existing lockout in the same statement:

1. **Confirm the caller really holds that phone number first** — for
   example, by calling them back on it — before changing anything.
2. Open **SQL Editor** in the Supabase dashboard.
3. Paste the block below, replacing `<PHONE>` with the shopkeeper's
   10-digit number (no `+91`, no spaces — e.g. `9876543210`) and
   `<NEW_PIN>` with a new 6-digit PIN.
4. Run it.

```sql
delete from private.login_attempts where phone = '<PHONE>';
update auth.users set encrypted_password = extensions.crypt('<NEW_PIN>', extensions.gen_salt('bf')), updated_at = now() where email = '<PHONE>@phone.local' returning email;
```

Exactly one row showing `<PHONE>@phone.local` means it worked. No rows
means the number was wrong and nothing changed. Tell the shopkeeper their
new PIN — they can sign in immediately, because the same block also clears
any lockout on that phone.

## Security rules

- The only public write path is `public.place_order` — there is no other
  way for an anonymous customer to write to the database.
- Product images are only ever written into the uploading vendor's own
  folder inside the `product-images` Storage bucket
  (`<store_id>/<file>.jpg`), enforced by `storage.objects` RLS policies —
  never by client-side trust.
- The service-role / secret key lives only in the Supabase dashboard. It is
  never referenced by any file under `src/`, never committed, and never set
  as a Vercel or CI environment variable — proven by `check:secrets`
  (bundle and src) and `check:gitleaks` (full git history) on every push.
