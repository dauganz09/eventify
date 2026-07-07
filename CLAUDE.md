# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev          # start dev server
npm run build        # production build
npm run lint         # ESLint

npm run db:generate  # generate Drizzle migrations from schema changes
npm run db:migrate   # apply migrations to the database
npm run db:push      # push schema directly (dev only, no migration file)
npm run db:studio    # open Drizzle Studio GUI
```

## Environment Variables

Only `DATABASE_URL` is required for local mode:

```env
DATABASE_URL=postgres://user:pass@localhost:5432/tabulate
```

Supabase variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are not needed and are ignored.

## Architecture

**Eventify** is a configurable event scoring and judging platform. Judges score contestants offline-safe; scores sync to the server via an idempotency-keyed outbox. MVP targets online/Supabase mode.

### Next.js Version Notes

This project uses **Next.js 16**, which has breaking changes from prior versions. Before writing any Next.js-specific code, read the relevant guide in `node_modules/next/dist/docs/`. One notable breaking change:

- **`proxy.ts` (not `middleware.ts`)** — session refresh for Supabase is handled in [`proxy.ts`](proxy.ts) at the project root, not `middleware.ts`. This file exports `proxy` and `config` and is invoked by the framework instead of `middleware`.

### Route Structure

```
app/
  (auth)/           # login page; no auth required
  (dashboard)/      # requires auth via requireAuthContext() in layout
    events/[eventId]/builder/  # step-by-step event configuration
    judge/           # judge scoring workspace
    tabulator/       # scoring progress dashboard
    settings/
  api/
    sync/score-operation/   # idempotent score submission endpoint
    events/[eventId]/reports/
  auth/callback/     # Supabase OAuth callback
```

### Auth Flow

The app uses a custom local auth system — no Supabase required.

1. **Signup/Login**: `app/api/auth/signup` and `app/api/auth/login` route handlers validate credentials, create a DB session, and set an HTTP-only `session_token` cookie.
2. **Session storage**: Two new tables — `local_credentials` (scrypt-hashed passwords) and `sessions` (token → user_id, expires_at).
3. [`lib/auth/local-session.ts`](lib/auth/local-session.ts) — password hashing (`hashPassword`, `verifyPassword` using Node `crypto.scrypt`), session CRUD (`createSession`, `getSessionUser`, `deleteSession`).
4. [`lib/auth/session.ts`](lib/auth/session.ts) — `getCurrentUser()` reads the `session_token` cookie and does a join on `sessions + user_profiles`.
5. [`lib/auth/context.ts`](lib/auth/context.ts) provides `getAuthContext()` and `requireAuthContext()`. Use `requireAuthContext()` in server components and route handlers to guard access.
6. [`lib/auth/bootstrap.ts`](lib/auth/bootstrap.ts) runs on every auth check: idempotently upserts the user profile and auto-creates an organization + owner membership.
7. Authorization is enforced via `requirePermission(permission)` or `assertPermission(context, permission)` from [`lib/auth/permissions.ts`](lib/auth/permissions.ts). Roles: `owner > admin > tabulator > judge > viewer > auditor`.
8. **Proxy** (`utils/supabase/proxy.ts`): only checks cookie presence for UX redirects — no DB call. Real auth validation happens in server components.
9. **`utils/supabase/client.ts`** exports `createClient()` with the same `.auth.signInWithPassword / signUp / signOut` API shape as the Supabase client — swap this file to re-integrate Supabase later.
10. **Logout**: `POST /api/auth/logout` deletes the DB session and clears the cookie. The sidebar calls this directly.

### Database

- Schema: all tables are defined in [`db/schema/index.ts`](db/schema/index.ts); exported from `@/db/schema`.
- DB client: [`db/index.ts`](db/index.ts) exports `db` (Drizzle instance). Import as `import { db } from "@/db"`.
- Migrations live in `drizzle/migrations/`. Always use `db:generate` then `db:migrate` to evolve the schema; never edit migration files manually.
- Score uniqueness is enforced by the `score_records_unique_scope_idx` unique index on `(event_id, round_id, contestant_id, judge_id, criterion_id)`.

### Score Submission Pipeline

The two-table design (`score_records` = current state, `score_events` = append-only history) is intentional for auditability and idempotency.

```
Judge enters score
  -> IndexedDB outbox (lib/sync/client-store.ts)
  -> hooks/use-offline-outbox.ts syncs on reconnect
  -> POST /api/sync/score-operation
  -> lib/scoring/score-service.ts: submitScoreOperation()
     - checks idempotency key in sync_operations
     - checks round.is_locked
     - upserts score_records with revision guard
     - inserts score_events
     - inserts audit_logs
     - records sync_operations result
     (all in one transaction)
  -> returns { status: "synced" | "conflict", revision, ... }
```

Domain services in `lib/` accept `database: typeof db` as a parameter to keep them testable without HTTP.

### Validation

All mutation input shapes are defined with Zod in [`lib/validation/domain.ts`](lib/validation/domain.ts). This project uses **Zod v4** — the API differs from v3 (e.g., `.flatten()` on `ZodError`, import path changes). Always import from `"zod"`.

### Realtime

Channel name helpers are in [`lib/realtime/channels.ts`](lib/realtime/channels.ts). In online mode, use Supabase Realtime; subscribe to event- or round-scoped channels. Publish aggregate events (e.g., `results.updated`) rather than raw score keystrokes.

### UI Components

shadcn/ui components live in `components/ui/` (do not edit these directly; use the `shadcn` CLI to add or update them). Domain-specific components are in `components/events/`, `components/scoring/`, and `components/app-shell/`.

### Key Design Invariants

- **Server authority**: final scores and results are always calculated server-side; never trust client totals.
- **Idempotent writes**: every score operation carries a client-generated `idempotencyKey`; the server deduplicates via `sync_operations`.
- **Score durability**: the client writes to IndexedDB before attempting network submission; scores must never be silently discarded.
- **Audit trail**: every score change, round lock, export, and role change must produce an `audit_logs` entry.
