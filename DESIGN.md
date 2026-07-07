# Dynamic Tabulation Web App Design

## 1. Purpose

This document describes the proposed technical and product design for the Dynamic Tabulation web app. It translates `REQUIREMENTS.md` into an implementation plan for a configurable judging and scoring system built with Next.js, Drizzle, PostgreSQL, Supabase, Tailwind CSS, and shadcn/ui.

The design prioritizes score durability, configurable event setup, clear judge workflows, real-time visibility, offline-safe scoring, and secure result calculation.

## 2. Design Principles

- **Score safety first**: A judge action must never be lost silently, even during network failure.
- **Server authority**: The client may calculate previews, but final results must be calculated and validated on the server.
- **Configurable, not hard-coded**: Events, rounds, criteria, contestants, display modes, scoring formulas, and themes must be data-driven.
- **Local-first scoring experience**: Judge scoring must remain usable during brief connectivity loss.
- **Idempotent writes**: Retried score submissions must be safe and must not create duplicates.
- **Auditability**: Critical changes must be traceable.
- **Responsive web-first UX**: The app is a browser-based product optimized for tablets, laptops, and desktops.
- **Progressive complexity**: MVP should support common pageant and contest workflows, then expand into advanced templates and hybrid deployment.

## 3. System Architecture

### 3.1 High-Level Architecture

```text
Browser Web App
  |
  | Next.js App Router pages, layouts, server actions, route handlers
  |
Application Services
  |
  | Drizzle ORM
  |
PostgreSQL

Online Mode:
  Supabase Postgres + Supabase Auth + Supabase Realtime

Local Mode:
  Local Postgres + app-managed auth/session service + local realtime service
```

### 3.2 Application Layers

- **Presentation layer**: Next.js App Router, React components, shadcn/ui, Tailwind CSS.
- **Client state layer**: React state for transient UI, TanStack Query or equivalent for server cache, IndexedDB for durable offline scoring queue.
- **Server interaction layer**: Server actions or route handlers for mutations, route handlers for exports and sync.
- **Domain service layer**: Event configuration, scoring, authorization, reporting, sync, and audit services.
- **Persistence layer**: Drizzle ORM over PostgreSQL.
- **Realtime layer**: Supabase Realtime in online mode; local WebSocket service in local mode.

### 3.3 Recommended Directory Structure

```text
app/
  (auth)/
  (dashboard)/
  events/
  judge/
  display/
  api/
components/
  ui/
  app-shell/
  events/
  scoring/
  reports/
db/
  index.ts
  queries/
  schema/
drizzle/
  migrations/
lib/
  auth/
  config/
  scoring/
  sync/
  realtime/
  reports/
  validation/
hooks/
  use-network-status.ts
  use-offline-outbox.ts
  use-score-draft.ts
types/
```

The current project already has `db/index.ts`, `drizzle/schema.ts`, and Supabase client helpers. As the schema grows, move from a single `drizzle/schema.ts` file into grouped schema files under `db/schema/` and re-export from an index file.

## 4. Deployment Modes

### 4.1 Online Mode

Online mode is the primary MVP target.

- Database: Supabase Postgres
- Auth: Supabase Auth
- Realtime: Supabase Realtime
- File storage: Supabase Storage or compatible object storage
- Hosting: Vercel or Node-compatible deployment

Online mode should use environment variables:

```env
APP_DEPLOYMENT_MODE=online
DATABASE_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
REALTIME_PROVIDER=supabase
```

### 4.2 Local Mode

Local mode is intended for self-hosted or offline event deployments.

- Database: Local PostgreSQL
- Auth: App-managed credentials or local identity provider
- Realtime: Local WebSocket server
- Hosting: Local Node server on event network

Local mode should use the same Drizzle schema and application services. Provider-specific code must sit behind adapter interfaces so core scoring logic remains shared.

### 4.3 Hybrid Mode

Hybrid mode is post-MVP. It allows local event operation with later upstream sync to an online server. This requires a more formal replication model and should not be mixed into the MVP data flow prematurely.

## 5. Core Domain Model

### 5.1 Main Entities

- **organizations**: Own events, users, themes, and settings.
- **users**: Authenticated people using the system.
- **memberships**: User roles within organizations.
- **events**: Top-level scored programs.
- **event_templates**: Reusable event configuration.
- **rounds**: Event phases, segments, or categories of scoring.
- **contestants**: People or teams being judged.
- **contestant_fields**: Configurable field definitions.
- **contestant_field_values**: Per-contestant custom values.
- **judges**: Users assigned to judge work.
- **judge_assignments**: Links judges to events, rounds, contestants, categories, or criteria.
- **criteria**: Scoring items and validation rules.
- **scoring_rules**: Calculation strategy, weights, tie-breakers, and normalization.
- **score_records**: Current authoritative score state.
- **score_events**: Append-only scoring operations and revisions.
- **score_conflicts**: Records requiring admin review.
- **aggregate_results**: Cached event, round, contestant, and criterion totals.
- **reports**: Export jobs and generated files.
- **themes**: Organization or event branding.
- **audit_logs**: Security and data change history.
- **sync_operations**: Idempotency keys and sync status.

### 5.2 Score Data Design

Use both current-state records and append-only events.

- `score_records` represents the latest authoritative score for a judge, contestant, round, and criterion.
- `score_events` records every scoring action, retry, revision, reopen, adjustment, and lock-related change.
- Final result calculation should use `score_records` by default but remain reproducible from `score_events`.

Recommended uniqueness:

```text
unique(event_id, round_id, contestant_id, judge_id, criterion_id)
unique(idempotency_key)
```

Recommended record fields:

```text
score_records
- id
- organization_id
- event_id
- round_id
- contestant_id
- judge_id
- criterion_id
- value
- comment
- status: draft | submitted | revised | voided
- revision
- submitted_at
- created_at
- updated_at
```

```text
score_events
- id
- idempotency_key
- organization_id
- event_id
- round_id
- contestant_id
- judge_id
- criterion_id
- operation: draft_saved | submitted | revised | voided | reopened
- previous_value
- next_value
- client_created_at
- server_received_at
- actor_user_id
- device_id
- metadata
```

### 5.3 Configuration Data

Event configuration should be structured JSON where flexibility matters, but critical queryable fields should remain relational.

Good JSON candidates:

- Theme tokens
- Contestant custom field values
- Rubric levels
- Display layout preferences
- Formula-specific options

Good relational candidates:

- Events
- Rounds
- Contestants
- Judges
- Assignments
- Criteria
- Score records
- Audit logs

## 6. Authorization Design

### 6.1 Role Model

Roles:

- Owner
- Admin
- Tabulator
- Judge
- Viewer
- Auditor

Authorization must be checked on the server for every mutation and protected read. Client-side checks are only for UX.

### 6.2 Permission Scopes

Permissions should be evaluated by:

- Organization
- Event
- Round
- Judge assignment
- Contestant assignment
- Criteria assignment

Examples:

- A judge can read only assigned events, rounds, contestants, and criteria.
- A tabulator can read all scores for assigned events but cannot change organization settings.
- An auditor can read logs and reports but cannot edit scores.
- A viewer can read only published results.

### 6.3 Supabase Auth Integration

In online mode, Supabase Auth handles identity and session lifecycle. The app still owns domain authorization through membership and assignment tables.

Supabase Row Level Security may be used as an additional protection layer, but application-level authorization must still exist because local mode cannot rely on Supabase RLS.

## 7. Scoring Engine Design

### 7.1 Score Input Types

The scoring engine should support a normalized internal representation:

```text
numeric
decimal
slider
rating
rank
boolean
rubric
text
penalty
bonus
```

Each criterion defines:

- Input type
- Min/max
- Step
- Required flag
- Weight
- Visibility
- Validation rules
- Optional rubric levels
- Optional help text

### 7.2 Calculation Pipeline

The calculation pipeline should be deterministic:

```text
Load eligible submitted scores
  -> validate score eligibility
  -> normalize values if needed
  -> apply criterion weights
  -> apply judge aggregation rule
  -> apply round aggregation rule
  -> apply penalties and bonuses
  -> apply tie-breakers
  -> persist aggregate snapshot
```

Supported aggregation rules:

- Sum
- Average
- Median
- Weighted sum
- Rank-based
- Drop highest
- Drop lowest
- Drop highest and lowest

### 7.3 Tie-Breaking

Tie-breaking rules should be event-configurable and ordered.

Examples:

- Highest score in a selected criterion
- Highest score in a selected round
- Lowest penalty
- Judge majority preference
- Manual tabulator decision

Manual tie-breaks must create audit entries.

## 8. Offline Scoring and Sync Design

### 8.1 Client Storage

Use IndexedDB for durable client-side scoring state.

Local stores:

- `scoreDrafts`
- `outbox`
- `syncAttempts`
- `cachedAssignments`
- `cachedEventConfig`
- `deviceMetadata`

Do not store secrets or privileged tokens in IndexedDB.

### 8.2 Outbox Operation Shape

Each scoring action writes locally first.

```text
outbox_operation
- local_id
- idempotency_key
- operation_type
- payload
- status: pending | syncing | synced | failed | conflict
- retry_count
- last_error
- created_at
- updated_at
```

The UI should treat a local outbox write as "saved locally" immediately, then show sync progress separately.

### 8.3 Sync Flow

```text
Judge enters score
  -> validate locally
  -> write draft or submit operation to IndexedDB
  -> update UI as saved locally
  -> if online, send operation to server
  -> server validates auth, assignment, lock state, version, idempotency
  -> server writes score transactionally
  -> server returns authoritative score revision
  -> client marks operation synced
  -> realtime notifies dashboards
```

### 8.4 Retry Strategy

- Retry failed network operations with exponential backoff.
- Retry immediately when browser reports network recovery.
- Stop automatic retries for permission, validation, locked-round, or conflict errors.
- Keep failed operations visible and recoverable.

### 8.5 Conflict Strategy

Most conflicts should be prevented through idempotency and unique constraints. Remaining conflicts should be explicit.

Conflict examples:

- Judge submits a stale score after an admin locked the round.
- Same judge submits different values from two devices.
- Admin reopens a score while an old offline operation syncs later.

Resolution:

- Server rejects stale operations with structured conflict response.
- Client marks operation as `conflict`.
- Admin or tabulator reviews conflict in a dedicated queue.
- Manual resolution writes a new `score_event` and audit log.

## 9. Real-Time Design

### 9.1 Transport Choice

Use WebSockets for authenticated operational features.

- Online mode: Supabase Realtime.
- Local mode: Local WebSocket server.
- SSE may be used later for read-only public display screens.

### 9.2 Real-Time Channels

Channels should be scoped narrowly:

```text
organization:{organizationId}
event:{eventId}
event:{eventId}:round:{roundId}
event:{eventId}:judge:{judgeId}
event:{eventId}:display
```

### 9.3 Real-Time Events

- `score.submitted`
- `score.revised`
- `score.conflict`
- `round.locked`
- `round.unlocked`
- `event.status_changed`
- `judge.presence_changed`
- `contestant.stage_changed`
- `results.updated`
- `report.ready`

Dashboards should subscribe to aggregate/result events, not every raw keystroke.

## 10. API Design

### 10.1 API Style

Use server actions for UI-local mutations when appropriate and route handlers for:

- Offline sync
- Exports
- Webhooks
- Public display feeds
- Long-running report jobs

All public mutation inputs must be validated with a schema library such as Zod.

### 10.2 Core Endpoints

```text
POST /api/sync/score-operation
POST /api/events
PATCH /api/events/:eventId
POST /api/events/:eventId/rounds/:roundId/lock
POST /api/events/:eventId/rounds/:roundId/unlock
POST /api/events/:eventId/recalculate
POST /api/events/:eventId/reports
GET  /api/events/:eventId/reports/:reportId
```

### 10.3 Score Submission Contract

Client sends:

```json
{
  "idempotencyKey": "client-generated-key",
  "deviceId": "browser-device-id",
  "eventId": "event-id",
  "roundId": "round-id",
  "contestantId": "contestant-id",
  "criterionId": "criterion-id",
  "value": 9.5,
  "comment": "Strong stage presence",
  "clientCreatedAt": "2026-05-26T12:00:00.000Z",
  "expectedRevision": 1
}
```

Server returns:

```json
{
  "status": "synced",
  "scoreRecordId": "score-record-id",
  "revision": 2,
  "serverReceivedAt": "2026-05-26T12:00:01.000Z"
}
```

## 11. UI Design

### 11.1 App Areas

- **Auth**: Sign in, invite acceptance, passwordless login where enabled.
- **Dashboard**: Organization overview, active events, pending tasks.
- **Event Builder**: Guided setup for event details, rounds, contestants, judges, criteria, scoring rules, and theme.
- **Judge Workspace**: Touch-friendly scoring flow optimized for tablet and laptop browsers.
- **Tabulator Console**: Score progress, missing scores, conflicts, locks, recalculation, finalization.
- **Analytics**: Standings, variance, judge behavior, score distribution, round breakdowns.
- **Reports**: Export creation, history, downloads.
- **Display Views**: Public or internal presentation screens.
- **Settings**: Organization, roles, theme, deployment mode, security settings.

### 11.2 Judge Workspace

Primary layout:

- Header with event, round, connection status, and sync state.
- Contestant navigation by list, card, or one-at-a-time flow.
- Large scoring controls optimized for touch.
- Sticky progress and submit area.
- Clear states for saved locally, syncing, synced, failed, and conflict.

Judge UI rules:

- Keep current contestant identity visible.
- Make incomplete criteria obvious.
- Require confirmation for final submit.
- Disable final submit only for invalid input, not for offline state.
- Show offline mode as recoverable and expected.

### 11.3 Admin Event Builder

Use a step-based workflow:

```text
Event Details
  -> Rounds
  -> Contestants
  -> Judges
  -> Criteria
  -> Scoring Rules
  -> Display and Theme
  -> Readiness Check
```

Readiness checks:

- Event has at least one round.
- Event has contestants.
- Event has assigned judges.
- Each active round has criteria.
- Each judge has assignments.
- Scoring rules are valid.
- Theme meets contrast rules.

### 11.4 Responsive Behavior

- Tablet: Judge workspace should be the primary design target.
- Laptop: Admin and tabulator views should use split panels and data tables.
- Desktop: Analytics and reporting can use denser layouts.
- Small mobile browser: Supported for emergency access, but not the primary judging experience.

## 12. Reporting Design

Reports should be generated from authoritative server data.

### 12.1 Report Types

- Final rankings
- Round rankings
- Contestant breakdown
- Judge score sheets
- Missing scores
- Score variance and outliers
- Audit log
- Event configuration snapshot

### 12.2 Export Formats

MVP:

- CSV
- PDF

Post-MVP:

- Excel-compatible spreadsheet

### 12.3 Report Generation

Small reports can be generated synchronously. Large reports should use an asynchronous job:

```text
request report
  -> create report job
  -> generate from authoritative data
  -> store file
  -> mark report ready
  -> notify user
```

Every report should include:

- Event name
- Round or scope
- Generation timestamp
- Event configuration version
- Result calculation rule summary

## 13. Security Design

### 13.1 Server-Side Enforcement

The server must enforce:

- Authentication
- Organization membership
- Role permissions
- Judge assignments
- Event and round lock state
- Score validation
- Export permissions

### 13.2 Input Protection

- Use Zod or equivalent validation for all mutations.
- Escape user-generated display content.
- Use Drizzle parameterized queries.
- Restrict file uploads by type, size, and storage location.
- Rate-limit sensitive endpoints.

### 13.3 Audit Logging

Audit entries must be created for:

- Role and membership changes
- Event configuration changes
- Criteria and scoring rule changes
- Judge assignment changes
- Score submissions, revisions, voids, and manual adjustments
- Round locks and unlocks
- Result publication
- Report exports
- Conflict resolution

## 14. Performance Design

### 14.1 Client Performance

- Keep judge scoring pages lightweight.
- Avoid loading large admin datasets in judge views.
- Use optimistic local state for scoring feedback.
- Debounce non-critical draft saves.
- Virtualize large contestant and score tables.

### 14.2 Database Performance

Add indexes for common filters:

- `event_id`
- `round_id`
- `contestant_id`
- `judge_id`
- `criterion_id`
- `organization_id`
- `status`
- `created_at`

Aggregate results should be cached and recalculated after score changes. Final results must be recalculable from score records and events.

### 14.3 Realtime Performance

- Scope channels per event or round.
- Publish aggregate updates rather than noisy low-level changes.
- Throttle dashboard refreshes when many scores arrive at once.
- Avoid sending private judge details to public displays.

## 15. Reliability Design

### 15.1 Transaction Boundaries

Score submission must happen in one database transaction:

```text
validate idempotency key
validate actor permission and assignment
validate event and round lock status
upsert score record with revision guard
insert score event
insert audit log
update or enqueue aggregate recalculation
record sync operation result
commit
```

### 15.2 Recovery

- Client outbox persists across refreshes.
- Sync resumes on reconnect.
- Server idempotency makes repeated requests safe.
- Aggregates can be rebuilt from source data.
- Admin finalization checks unresolved conflicts and missing scores.

## 16. Implementation Phases

### Phase 1: Foundation

- Normalize Drizzle schema structure.
- Add auth and role model.
- Add organization and event base tables.
- Add shadcn/ui and base app shell.
- Add environment-based deployment mode config.

### Phase 2: Event Setup

- Event CRUD.
- Contestant CRUD.
- Judge CRUD.
- Round and criteria configuration.
- Basic event readiness check.

### Phase 3: Scoring MVP

- Judge assignment queries.
- Judge scoring workspace.
- Numeric and decimal score inputs.
- Draft and submit flow.
- Server-side score validation.
- Score records and score events.

### Phase 4: Offline Sync

- IndexedDB drafts and outbox.
- Idempotent score sync endpoint.
- Retry and reconnect handling.
- Sync status UI.
- Conflict queue.

### Phase 5: Results and Realtime

- Aggregate calculation engine.
- Tabulator progress dashboard.
- Supabase Realtime subscriptions.
- Round locking and result publication.

### Phase 6: Reports and Theming

- CSV export.
- PDF export.
- Basic theme configuration.
- Public display view.

## 17. Key Tradeoffs

### WebSockets vs SSE

WebSockets are the primary design because the app needs authenticated real-time dashboards, presence, operational events, and future bidirectional control. SSE remains useful for public display feeds where the server only pushes read-only updates.

### Supabase RLS vs Application Authorization

Supabase RLS is useful defense-in-depth in online mode, but the app should still implement authorization in application services so local mode and tests use the same permission model.

### Current Score Records vs Append-Only Score Events

Using both adds storage and implementation complexity, but it improves auditability, reproducibility, performance, and conflict handling. `score_records` gives fast reads; `score_events` gives history.

### Online MVP vs Local Mode First

Online mode should ship first because Supabase covers auth, Postgres, and realtime. Local mode should reuse the same data model and business services but can be added after the core workflows are stable.

## 18. Open Design Decisions

- Whether local mode should support independent offline judge devices or only a local network server.
- Whether submitted judge scores can be self-edited before round lock.
- Whether every score comment is optional, required by criterion, or required only for low/high scores.
- Whether public results are manually published or auto-published after round lock.
- Whether report generation should use an internal queue, database-backed jobs, or an external worker.
- Whether event templates should be organization-scoped or globally shared.
- Whether hybrid server sync is needed for the first paid version.

## 19. MVP Success Criteria

- Admin can create an event, contestants, judges, rounds, and numeric criteria.
- Judge can score assigned contestants from a tablet or laptop browser.
- Scores are saved locally before network submission.
- Scores entered offline sync automatically after reconnect.
- Duplicate sync attempts do not duplicate scores.
- Tabulator can see scoring progress and missing submissions.
- Admin can lock a round and generate final rankings.
- CSV and PDF reports can be exported from authoritative server data.
- Unauthorized users cannot read or mutate private event data.
