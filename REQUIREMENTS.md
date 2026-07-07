# Dynamic Tabulation Web App Requirements

## 1. Product Overview

The Dynamic Tabulation app is a responsive web application for configurable event scoring and judging in events such as pageants, talent contests, academic competitions, auditions, sports judging, and other scored programs. The system must support event setup, contestant management, judge assignment, scoring workflows, live results, analytics, exports, authentication, offline-safe scoring, and real-time updates.

The app must run in modern web browsers and be reliable in environments where judges primarily use tablet or laptop browsers and where network connectivity may be unstable during live events.

## 2. Goals

- Allow administrators to configure many types of judged events without code changes.
- Let judges submit scores quickly, accurately, and with minimal training.
- Preserve every score even when network connectivity is lost.
- Synchronize offline scores automatically when connectivity returns.
- Prevent duplicate scores, race conditions, accidental overwrites, and result tampering.
- Provide live analytics, standings, and reports for event organizers.
- Support online Supabase deployments and configurable local Postgres deployments.
- Deliver a modern, responsive, accessible, themeable UI.
- Remain a web-first product; native mobile apps are out of scope unless added later.

## 3. Primary Users

- **System Owner**: Manages organizations, billing or deployment settings, and global configuration.
- **Event Administrator**: Creates events, configures criteria, assigns judges, manages contestants, and controls event flow.
- **Tabulator**: Reviews submitted scores, monitors discrepancies, locks rounds, exports reports, and validates final results.
- **Judge**: Scores assigned contestants or teams using tablet or laptop UI.
- **Host or Display Operator**: Views live rankings, contestant views, scoreboards, and presentation screens.
- **Auditor**: Reviews score history, changes, exports, and event logs.

## 4. Core Functional Requirements

### 4.1 Authentication and Authorization

- Users must authenticate before accessing private event data.
- The app must support role-based access control.
- A user may belong to multiple organizations or events.
- Permissions must be scoped by organization, event, round, and role.
- Judges must only access contestants, rounds, and criteria assigned to them.
- Sensitive admin and tabulation actions must be audited.
- Sessions must refresh securely for online deployments.

Required roles:

- Owner
- Admin
- Tabulator
- Judge
- Viewer
- Auditor

### 4.2 Event Management

- Admins must be able to create, update, duplicate, archive, and delete events.
- Events must support configurable phases, segments, or rounds.
- Events must support configurable scoring rules per round.
- Events must support event status values such as draft, active, paused, completed, archived.
- Admins must be able to lock and unlock scoring by event, round, criterion, judge, or contestant.
- Admins must be able to publish selected results without exposing hidden scoring data.

Event configuration must include:

- Event name, description, schedule, venue, timezone
- Event type or template
- Contestant display mode
- Scoring model
- Criteria and weights
- Tie-break rules
- Judge assignments
- Result visibility rules
- Theme and branding

### 4.3 Contestant Management

- Admins must be able to create, update, import, archive, and reorder contestants.
- Contestants must support configurable fields.
- Contestants may represent individuals, teams, schools, organizations, or groups.
- Contestants must support photos, display names, numbers, categories, divisions, and metadata.
- Contestant order must be configurable per round.
- Admins must be able to choose how contestants are displayed to judges and viewers.

Contestant view options:

- List view
- Card grid
- One-at-a-time scoring view
- Category or division grouped view
- Stage order view
- Searchable/filterable table

### 4.4 Judge Management

- Admins must be able to invite, assign, activate, deactivate, and remove judges.
- Judges may be assigned to specific events, rounds, categories, contestants, or criteria.
- Judges must have a simplified scoring interface focused on assigned work.
- Judges must see clear progress indicators.
- Judges must be warned before submitting incomplete or invalid scores.
- Judges must be able to resume scoring after reconnecting, refreshing, or switching devices if permitted.

### 4.5 Criteria and Scoring Configuration

- The system must support configurable scoring criteria for any event scenario.
- Criteria may be reused through templates.
- Scoring must support multiple input types.
- Criteria must support validation rules, weights, and visibility controls.
- Admins must be able to preview the judge scoring UI before publishing an event.

Supported scoring input types:

- Numeric score
- Decimal score
- Slider
- Star or rating scale
- Rank order
- Yes/no
- Pass/fail
- Rubric levels
- Text comments
- Penalty or deduction
- Bonus points

Scoring configuration must support:

- Minimum and maximum values
- Step increments
- Weighted criteria
- Required or optional criteria
- Per-round criteria
- Per-category criteria
- Judge-specific criteria
- Automatic total calculation
- Dropping highest and/or lowest scores
- Average, sum, median, weighted sum, and rank-based calculations
- Tie-break criteria
- Score normalization where needed
- Manual adjustment with audit trail

### 4.6 Scoring Workflow

- Judges must be able to save draft scores.
- Judges must be able to submit final scores.
- Submitted scores must be immutable unless an authorized role reopens or revises them.
- Every score change must create an audit entry.
- The app must prevent duplicate score submissions for the same judge, contestant, round, and criterion.
- The app must prevent race conditions using idempotent writes, unique constraints, version checks, and transactions.
- Score calculations must be deterministic and reproducible.
- Admins and tabulators must see score submission progress in real time.
- The system must support score locking once a round or event is finalized.

### 4.7 Offline and Sync Requirements

Scoring must not be lost during connectivity issues.

- Judge scoring screens must remain usable during temporary network loss.
- Draft and submitted scores must be stored locally before network transmission.
- The client must maintain an offline outbox for pending scoring operations.
- Each scoring operation must have a stable client-generated idempotency key.
- The server must accept retried operations safely without creating duplicates.
- The app must automatically sync queued scores when connectivity returns.
- Users must see clear sync states: saved locally, syncing, synced, failed, conflict.
- Failed sync attempts must be retried with backoff.
- Conflicts must be resolved predictably and surfaced to admins when manual review is needed.
- Local drafts must survive refreshes, browser restarts, and temporary device sleep.
- The app must never silently discard local scores.

Recommended client storage:

- IndexedDB for browser-based offline queue and draft persistence.
- LocalStorage may only be used for small non-sensitive UI preferences.

Conflict prevention requirements:

- Use unique constraints for judge, contestant, event, round, and criterion score records.
- Use server-generated revision numbers or timestamps for optimistic concurrency.
- Use database transactions for score submission and aggregate updates.
- Treat score submission as append-only events where possible.
- Derive final totals from score events or immutable score records.

### 4.8 Real-Time Updates

The app must provide real-time updates for scoring progress, dashboards, results, and event status changes.

Recommended transport:

- Use WebSockets for authenticated, bidirectional real-time features.
- Use Supabase Realtime when running online with Supabase.
- Use Server-Sent Events only for read-only streams such as public display dashboards if bidirectional communication is not required.

Reasoning:

- Judges submit scores through authenticated HTTP mutations that must be idempotent and transactional.
- Admin dashboards, tabulators, and display screens need live updates.
- WebSockets are better than SSE for authenticated app-wide collaboration, presence, connection status, and future bidirectional controls.
- SSE is simpler and useful for one-way public display updates, but it is less flexible for interactive event operations.

Real-time features:

- Judge online/offline presence
- Score submission progress
- Contestant currently on stage
- Round status changes
- Live standings for authorized users
- Public display updates
- Sync queue status for admins where appropriate

### 4.9 Analytics and Reporting

- Admins and tabulators must have analytics dashboards.
- Analytics must support filtering by event, round, judge, contestant, category, and criterion.
- The app must identify missing scores, outliers, scoring variance, and judge completion status.
- The app must provide final rankings and detailed breakdowns.
- The app must support exportable reports.

Required exports:

- CSV
- Excel-compatible spreadsheet
- PDF summary report
- Judge score sheets
- Contestant score breakdown
- Round rankings
- Final rankings
- Audit log export

### 4.10 Themes and Branding

- The UI theme must be configurable per organization or event.
- Themes must support light and dark modes.
- Theme configuration must include colors, logo, typography choices, and display branding.
- Theme changes must not break accessibility contrast requirements.
- Public display screens may use event-specific branding.

## 5. Technical Requirements

### 5.1 Stack

- Next.js App Router
- TypeScript
- React
- Drizzle ORM
- PostgreSQL
- Supabase for hosted online deployments
- Local Postgres for offline or self-hosted deployments
- shadcn/ui for design system and components
- Tailwind CSS for styling

### 5.2 Database Configuration

The app must support configurable database modes:

- **Online mode**: Supabase Postgres, Supabase Auth, Supabase Realtime.
- **Local mode**: Local Postgres with app-managed auth/session strategy and local real-time service.

Configuration must be controlled through environment variables.

Suggested variables:

```env
DATABASE_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
APP_DEPLOYMENT_MODE=online
REALTIME_PROVIDER=supabase
```

Supported deployment modes:

- `online`: Supabase-backed production deployment.
- `local`: Local Postgres deployment for offline or local network use.
- `hybrid`: Local-first event operation with later server sync, if required by future scope.

### 5.3 Data Model Requirements

The database must model:

- Organizations
- Users
- Memberships and roles
- Events
- Event templates
- Rounds
- Contestants
- Contestant fields and values
- Judges
- Judge assignments
- Criteria
- Scoring rules
- Score records
- Score submission events
- Score revisions
- Aggregate results
- Reports and exports
- Theme settings
- Audit logs
- Sync operations and idempotency keys

### 5.4 API Requirements

- All mutations must validate input with schemas.
- Score submission APIs must be idempotent.
- APIs must enforce authorization on the server.
- APIs must return structured errors.
- APIs must distinguish validation errors, permission errors, conflicts, and network retryable failures.
- APIs must support pagination for large events.
- APIs must avoid exposing hidden results to unauthorized roles.

### 5.5 Security Requirements

- Enforce server-side authorization for every protected action.
- Never trust client-calculated totals for final results.
- Validate and sanitize all user input.
- Protect against SQL injection through parameterized ORM queries.
- Protect against XSS by escaping user-generated content.
- Protect against CSRF where cookie-based auth is used.
- Rate-limit login, invite, export, and score submission endpoints.
- Store secrets only in server-side environment variables.
- Use least-privilege database access.
- Keep audit logs for score changes, locks, exports, role changes, and configuration changes.
- Support secure session handling and session expiry.
- Avoid logging sensitive tokens, passwords, or private event data.

### 5.6 Scalability and Performance

- The app must support multiple active events.
- The scoring UI must remain fast on tablets and laptops.
- Dashboards must handle frequent score updates without excessive re-rendering.
- Large lists must use pagination, filtering, or virtualization.
- Aggregates should be computed efficiently and cached when appropriate.
- Reports should be generated asynchronously for large events.
- Real-time channels should be scoped by event and role.
- Database indexes must support common queries for event, round, judge, contestant, and score lookup.

### 5.7 Reliability

- Score writes must be transactional.
- Aggregates must be recalculable from source score records.
- Background sync must be retryable.
- The app must provide clear recovery paths after refresh, disconnect, or failed submission.
- Event finalization must verify missing scores and unresolved conflicts before publishing.
- Reports must include generation timestamps and event version metadata.

## 6. UI and UX Requirements

### 6.1 General UI

- The app must be responsive for tablets, laptops, and desktop screens.
- The app must use modern, clean UI patterns.
- Primary actions must be clear and reachable.
- Critical actions must require confirmation.
- Complex admin setup should be broken into guided steps.
- Users must receive immediate feedback after saving, submitting, syncing, or encountering errors.
- The UI must follow accessibility best practices for keyboard navigation, labels, focus states, and contrast.

### 6.2 Judge UI

- Judge screens must prioritize fast scoring and low cognitive load.
- Scores must be easy to enter on touch devices.
- Current contestant, criteria, progress, and sync status must be visible.
- Judges must be able to move between assigned contestants efficiently.
- The UI must prevent accidental submission.
- Offline mode must be obvious but non-blocking.
- Validation messages must be specific and actionable.

### 6.3 Admin UI

- Event setup must include a preview mode.
- Admins must be able to configure criteria, contestants, judges, scoring rules, and display views.
- Admins must see readiness checks before starting an event.
- Admins must monitor judge progress and sync health.
- Admins must be able to lock rounds and publish results.

### 6.4 Display and Viewer UI

- Viewer screens must support public display layouts.
- Public displays must avoid exposing private judge details unless explicitly configured.
- Display screens must update live when event status or rankings change.
- Presentation views must support full-screen usage.

## 7. Non-Functional Requirements

### 7.1 Accessibility

- Meet WCAG 2.1 AA where practical.
- Support keyboard navigation.
- Support screen reader labels for interactive controls.
- Maintain color contrast across configurable themes.
- Support responsive text and touch-friendly controls.

### 7.2 Browser and Device Support

- Modern Chromium, Safari, and Firefox.
- iPad and Android tablet browsers through the web app.
- Laptop and desktop browsers.
- Touch and pointer input.
- Native iOS and Android apps are not required for the initial product.

### 7.3 Observability

- Log server errors with request context.
- Track failed sync attempts.
- Track score submission latency.
- Track real-time connection health.
- Track export generation failures.
- Provide admin-visible health indicators during active events.

### 7.4 Backup and Recovery

- Online deployments must rely on managed database backup policies.
- Local deployments must provide documented database backup and restore procedures.
- Audit logs and score records must be retained according to organization policy.
- Exported reports must be reproducible from stored score data.

## 8. Suggested MVP Scope

MVP should include:

- Supabase online mode
- Email/password or magic-link auth
- Role-based organization and event access
- Event creation
- Contestant CRUD
- Judge CRUD and assignments
- Criteria configuration
- Numeric and decimal scoring
- Score draft and submit workflow
- IndexedDB offline score queue
- Automatic sync on reconnect
- Admin scoring progress dashboard
- Final ranking calculation
- CSV and PDF export
- Basic theme configuration
- Responsive judge UI

Post-MVP:

- Local mode installer or deployment profile
- Advanced scoring templates
- Public display screens
- WebSocket presence
- Advanced analytics
- Excel export
- Hybrid local-first event server
- Multi-language support
- Billing or subscription management

## 9. Open Questions

- Should local mode mean a single laptop running the full app on a local network, or each judge device working fully offline?
- Should Supabase Auth be required in online mode, or should the app support a custom auth provider?
- Are events owned by one organization only, or can events be shared across organizations?
- Should judges be able to edit submitted scores before a round is locked?
- Are score comments required for all scoring types or only selected criteria?
- Should public results be published automatically or only after admin approval?
- Which report formats are legally or operationally required by target customers?
- Should the app support multiple languages and right-to-left layouts in the first release?

## 10. Acceptance Criteria

- An admin can configure and run a basic event without developer support.
- A judge can score assigned contestants from a tablet or laptop.
- Scores entered during network loss are stored locally and sync after reconnection.
- Duplicate score submissions do not create duplicate records.
- Final results can be recalculated from stored score data.
- Admins can export final reports.
- Unauthorized users cannot access private event data.
- The UI remains usable and responsive on tablet-sized screens.
- Theme changes are reflected without breaking core workflows.
- Active event dashboards update in real time for authorized users.
