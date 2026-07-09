import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const appRole = pgEnum("app_role", [
  "owner",
  "admin",
  "tabulator",
  "judge",
  "viewer",
  "auditor",
]);

export const eventStatus = pgEnum("event_status", [
  "draft",
  "active",
  "paused",
  "completed",
  "archived",
]);

export const scoreStatus = pgEnum("score_status", [
  "draft",
  "submitted",
  "revised",
  "voided",
]);

export const scoreOperation = pgEnum("score_operation", [
  "draft_saved",
  "submitted",
  "revised",
  "voided",
  "reopened",
  "manual_adjustment",
]);

export const syncStatus = pgEnum("sync_status", [
  "pending",
  "syncing",
  "synced",
  "failed",
  "conflict",
]);

export const reportStatus = pgEnum("report_status", [
  "queued",
  "processing",
  "ready",
  "failed",
]);

// Lifecycle of a round group ("round") or a round ("set") in the run-of-show.
// idle = not open for scoring; active = currently open; finished = closed,
// scores final and eligible to carry over into later rounds.
export const roundLifecycle = pgEnum("round_lifecycle", [
  "idle",
  "active",
  "finished",
]);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const userProfiles = pgTable("user_profiles", {
  id: uuid("id").primaryKey(),
  displayName: varchar("display_name", { length: 160 }),
  email: varchar("email", { length: 320 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const memberships = pgTable(
  "memberships",
  {
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => userProfiles.id, { onDelete: "cascade" })
      .notNull(),
    role: appRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId, table.role] }),
  ],
);

export const invitations = pgTable("invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  role: appRole("role").notNull(),
  tokenHash: text("token_hash").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const eventTemplates = pgTable("event_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, {
    onDelete: "cascade",
  }),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const events = pgTable("events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  templateId: uuid("template_id").references(() => eventTemplates.id, {
    onDelete: "set null",
  }),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  logoUrl: text("logo_url"),
  venue: varchar("venue", { length: 200 }),
  timezone: varchar("timezone", { length: 80 }).notNull().default("UTC"),
  status: eventStatus("status").notNull().default("draft"),
  contestantDisplayMode: varchar("contestant_display_mode", { length: 80 })
    .notNull()
    .default("one-at-a-time"),
  resultVisibility: jsonb("result_visibility").$type<Record<string, unknown>>().notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  // Soft delete: when set, the event (and all data reachable through it) is
  // hidden from the app but retained for restore. All child tables cascade
  // from this row and are only ever queried via eventId, so hiding the event
  // implicitly hides everything under it — no per-table flag needed.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const roundGroups = pgTable("round_groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .references(() => events.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  position: integer("position").notNull().default(0),
  // Run-of-show lifecycle. At most one round group may be "active" per event.
  status: roundLifecycle("status").notNull().default("idle"),
  // When true, this group's final score = its own sets + all previous groups' scores combined.
  // When false, this group is scored independently (previous groups used only for seeding).
  carryOverScores: boolean("carry_over_scores").notNull().default(false),
  // Weight (0–100) applied to this round's score contribution when carrying over.
  // e.g. 30 means this round counts 30% of the final weighted total.
  // Defaults to 100 (full weight) for backward compatibility.
  carryOverWeight: integer("carry_over_weight").notNull().default(100),
  // When set (e.g. 5), only the top N contestants — by cumulative standings of
  // the previously finished rounds — may be scored in this round. Null = all.
  advanceCount: integer("advance_count"),
  // Ordering of the qualified contestants in the judge panel:
  // "number" = by contestant number (hides current standings), "rank" = by rank.
  advanceDisplayOrder: varchar("advance_display_order", { length: 20 })
    .notNull()
    .default("number"),
  // How this round decides its winner: "points" = highest averaged total wins;
  // "rank_order" = each judge's totals become ranks, ranks are summed across
  // judges, and the LOWEST rank-sum wins (judges'-majority tie-break).
  scoringMethod: varchar("scoring_method", { length: 20 }).notNull().default("points"),
  // Snapshot of the qualifying contestant ids (in rank order, best first),
  // written when this round is activated. Kept stable for auditability even if
  // earlier rounds' scores are edited afterwards.
  qualifiedContestantIds: jsonb("qualified_contestant_ids").$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const rounds = pgTable("rounds", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .references(() => events.id, { onDelete: "cascade" })
    .notNull(),
  roundGroupId: uuid("round_group_id").references(() => roundGroups.id, {
    onDelete: "set null",
  }),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  position: integer("position").notNull().default(0),
  // Run-of-show lifecycle. At most one set may be "active" per event.
  // `isLocked` is kept in sync (locked unless status === "active") so the
  // score-submission pipeline's lock guard keeps working unchanged.
  status: roundLifecycle("status").notNull().default("idle"),
  isLocked: boolean("is_locked").notNull().default(false),
  // Manual-entry set (e.g. a pre-event category scored offline). Judges never
  // score these; the tabulator types one final score per candidate, attributed
  // to the event's system judge. Exempt from the score pipeline's lock guard.
  isManualEntry: boolean("is_manual_entry").notNull().default(false),
  // Decided when the parent round is finished via the Finish-round modal.
  // When true, this set's per-contestant total is added to the active round's
  // "Carried-in" column. The tabulator can choose per-set granularity.
  carryOverScores: boolean("carry_over_scores").notNull().default(false),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const contestants = pgTable(
  "contestants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .references(() => events.id, { onDelete: "cascade" })
      .notNull(),
    displayNumber: varchar("display_number", { length: 40 }),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    category: varchar("category", { length: 120 }),
    division: varchar("division", { length: 120 }),
    photoUrl: text("photo_url"),
    position: integer("position").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("contestants_event_display_number_idx").on(
      table.eventId,
      table.displayNumber,
    ),
  ],
);

export const contestantFields = pgTable("contestant_fields", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .references(() => events.id, { onDelete: "cascade" })
    .notNull(),
  label: varchar("label", { length: 120 }).notNull(),
  key: varchar("key", { length: 80 }).notNull(),
  inputType: varchar("input_type", { length: 40 }).notNull(),
  position: integer("position").notNull().default(0),
  isRequired: boolean("is_required").notNull().default(false),
});

export const contestantFieldValues = pgTable(
  "contestant_field_values",
  {
    contestantId: uuid("contestant_id")
      .references(() => contestants.id, { onDelete: "cascade" })
      .notNull(),
    fieldId: uuid("field_id")
      .references(() => contestantFields.id, { onDelete: "cascade" })
      .notNull(),
    value: text("value"),
  },
  (table) => [primaryKey({ columns: [table.contestantId, table.fieldId] })],
);

export const judges = pgTable(
  "judges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .references(() => events.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id").references(() => userProfiles.id, {
      onDelete: "set null",
    }),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    username: varchar("username", { length: 80 }),
    passwordHash: text("password_hash"),
    email: varchar("email", { length: 320 }),
    isActive: boolean("is_active").notNull().default(true),
    // A non-login "judge" the tabulator uses to attribute manually-entered
    // scores (pre-event categories). One per event, lazily created; excluded
    // from all judge-facing UI, online counts, and scoring matrices.
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("judges_username_unique_idx")
      .on(table.username)
      .where(sql`${table.username} IS NOT NULL`),
  ],
);

export const criteria = pgTable("criteria", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .references(() => events.id, { onDelete: "cascade" })
    .notNull(),
  roundId: uuid("round_id").references(() => rounds.id, {
    onDelete: "cascade",
  }),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  inputType: varchar("input_type", { length: 40 }).notNull().default("decimal"),
  minValue: numeric("min_value", { precision: 10, scale: 2 }),
  maxValue: numeric("max_value", { precision: 10, scale: 2 }),
  stepValue: numeric("step_value", { precision: 10, scale: 2 }),
  weight: numeric("weight", { precision: 10, scale: 4 }).notNull().default("1"),
  position: integer("position").notNull().default(0),
  isRequired: boolean("is_required").notNull().default(true),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const judgeAssignments = pgTable(
  "judge_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .references(() => events.id, { onDelete: "cascade" })
      .notNull(),
    judgeId: uuid("judge_id")
      .references(() => judges.id, { onDelete: "cascade" })
      .notNull(),
    // Set-level scope (legacy granularity; still honored when present).
    roundId: uuid("round_id").references(() => rounds.id, {
      onDelete: "cascade",
    }),
    // Round-level scope: the judge scores every set inside this round group.
    // Both null = event-wide (the judge scores everything).
    roundGroupId: uuid("round_group_id").references(() => roundGroups.id, {
      onDelete: "cascade",
    }),
    contestantId: uuid("contestant_id").references(() => contestants.id, {
      onDelete: "cascade",
    }),
    criterionId: uuid("criterion_id").references(() => criteria.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("judge_assignment_scope_idx").on(
      table.eventId,
      table.judgeId,
      table.roundId,
      table.contestantId,
      table.criterionId,
    ),
  ],
);

export const scoringRules = pgTable("scoring_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .references(() => events.id, { onDelete: "cascade" })
    .notNull(),
  roundId: uuid("round_id").references(() => rounds.id, {
    onDelete: "cascade",
  }),
  name: varchar("name", { length: 160 }).notNull(),
  aggregation: varchar("aggregation", { length: 80 }).notNull().default("weighted_sum"),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const scoreRecords = pgTable(
  "score_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    eventId: uuid("event_id")
      .references(() => events.id, { onDelete: "cascade" })
      .notNull(),
    roundId: uuid("round_id")
      .references(() => rounds.id, { onDelete: "cascade" })
      .notNull(),
    contestantId: uuid("contestant_id")
      .references(() => contestants.id, { onDelete: "cascade" })
      .notNull(),
    judgeId: uuid("judge_id")
      .references(() => judges.id, { onDelete: "cascade" })
      .notNull(),
    criterionId: uuid("criterion_id")
      .references(() => criteria.id, { onDelete: "cascade" })
      .notNull(),
    value: numeric("value", { precision: 12, scale: 4 }),
    comment: text("comment"),
    status: scoreStatus("status").notNull().default("draft"),
    revision: integer("revision").notNull().default(1),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("score_records_unique_scope_idx").on(
      table.eventId,
      table.roundId,
      table.contestantId,
      table.judgeId,
      table.criterionId,
    ),
    index("score_records_event_status_idx").on(table.eventId, table.status),
    index("score_records_event_round_status_idx").on(
      table.eventId,
      table.roundId,
      table.status,
    ),
  ],
);

export const scoreEvents = pgTable(
  "score_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    scoreRecordId: uuid("score_record_id").references(() => scoreRecords.id, {
      onDelete: "set null",
    }),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    eventId: uuid("event_id")
      .references(() => events.id, { onDelete: "cascade" })
      .notNull(),
    roundId: uuid("round_id")
      .references(() => rounds.id, { onDelete: "cascade" })
      .notNull(),
    contestantId: uuid("contestant_id")
      .references(() => contestants.id, { onDelete: "cascade" })
      .notNull(),
    judgeId: uuid("judge_id")
      .references(() => judges.id, { onDelete: "cascade" })
      .notNull(),
    criterionId: uuid("criterion_id")
      .references(() => criteria.id, { onDelete: "cascade" })
      .notNull(),
    operation: scoreOperation("operation").notNull(),
    previousValue: numeric("previous_value", { precision: 12, scale: 4 }),
    nextValue: numeric("next_value", { precision: 12, scale: 4 }),
    actorUserId: uuid("actor_user_id").references(() => userProfiles.id, {
      onDelete: "set null",
    }),
    deviceId: varchar("device_id", { length: 160 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
    clientCreatedAt: timestamp("client_created_at", { withTimezone: true }).notNull(),
    serverReceivedAt: timestamp("server_received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Tamper-evident hash chain: each event stores the previous event's hash
    // (per event, ordered by seq) plus a SHA-256 of its own content. Editing or
    // removing a historical row breaks the chain, which the "Verify integrity"
    // check detects. Null hash = legacy row written before the chain existed.
    seq: bigserial("seq", { mode: "number" }).notNull(),
    prevHash: text("prev_hash"),
    hash: text("hash"),
  },
  (table) => [
    uniqueIndex("score_events_idempotency_idx").on(table.idempotencyKey),
    index("score_events_event_seq_idx").on(table.eventId, table.seq),
  ],
);

export const scoreConflicts = pgTable("score_conflicts", {
  id: uuid("id").defaultRandom().primaryKey(),
  scoreEventId: uuid("score_event_id").references(() => scoreEvents.id, {
    onDelete: "cascade",
  }),
  eventId: uuid("event_id")
    .references(() => events.id, { onDelete: "cascade" })
    .notNull(),
  reason: text("reason").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedByUserId: uuid("resolved_by_user_id").references(() => userProfiles.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const aggregateResults = pgTable("aggregate_results", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .references(() => events.id, { onDelete: "cascade" })
    .notNull(),
  roundId: uuid("round_id").references(() => rounds.id, {
    onDelete: "cascade",
  }),
  contestantId: uuid("contestant_id").references(() => contestants.id, {
    onDelete: "cascade",
  }),
  total: numeric("total", { precision: 14, scale: 4 }).notNull().default("0"),
  rank: integer("rank"),
  breakdown: jsonb("breakdown").$type<Record<string, unknown>>().notNull(),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const reports = pgTable("reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .references(() => events.id, { onDelete: "cascade" })
    .notNull(),
  requestedByUserId: uuid("requested_by_user_id").references(() => userProfiles.id, {
    onDelete: "set null",
  }),
  type: varchar("type", { length: 80 }).notNull(),
  format: varchar("format", { length: 20 }).notNull(),
  status: reportStatus("status").notNull().default("queued"),
  fileUrl: text("file_url"),
  error: text("error"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/**
 * Saved print report definitions that combine scores from arbitrary sets
 * (e.g. "Miss Eloquence" = Evening Gown from Prelim + Q&A from Semi-finals).
 */
export const customPrintReports = pgTable("custom_print_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .references(() => events.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  /** Ordered list of set (rounds) ids whose scores are combined for ranking. */
  setIds: jsonb("set_ids").$type<string[]>().notNull(),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const themes = pgTable("themes", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  eventId: uuid("event_id").references(() => events.id, {
    onDelete: "cascade",
  }),
  name: varchar("name", { length: 120 }).notNull(),
  tokens: jsonb("tokens").$type<Record<string, string>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, {
    onDelete: "cascade",
  }),
  eventId: uuid("event_id").references(() => events.id, {
    onDelete: "cascade",
  }),
  actorUserId: uuid("actor_user_id").references(() => userProfiles.id, {
    onDelete: "set null",
  }),
  action: varchar("action", { length: 120 }).notNull(),
  entityType: varchar("entity_type", { length: 80 }).notNull(),
  entityId: uuid("entity_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});


export const judgeSessions = pgTable("judge_sessions", {
  token: varchar("token", { length: 64 }).primaryKey(),
  judgeId: uuid("judge_id")
    .references(() => judges.id, { onDelete: "cascade" })
    .notNull(),
  eventId: uuid("event_id")
    .references(() => events.id, { onDelete: "cascade" })
    .notNull(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// A judge's certification that they're DONE scoring a set ("submit & lock").
// One row per (judge, set). Presence = finalized. Their scores for that set
// become read-only on the judge side until a tabulator releases the lock.
export const judgeSetSubmissions = pgTable(
  "judge_set_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .references(() => events.id, { onDelete: "cascade" })
      .notNull(),
    roundId: uuid("round_id")
      .references(() => rounds.id, { onDelete: "cascade" })
      .notNull(),
    judgeId: uuid("judge_id")
      .references(() => judges.id, { onDelete: "cascade" })
      .notNull(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("judge_set_submissions_unique_idx").on(table.roundId, table.judgeId),
  ],
);

export const unlockRequestStatus = pgEnum("unlock_request_status", [
  "pending",
  "approved",
  "rejected",
]);

/**
 * A judge's request to have their "submit & lock" released so they can edit
 * scores again. One pending request allowed per (round, judge) at a time.
 * The tabulator approves or rejects it from the tabulator console.
 */
export const unlockRequests = pgTable(
  "unlock_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .references(() => events.id, { onDelete: "cascade" })
      .notNull(),
    roundId: uuid("round_id")
      .references(() => rounds.id, { onDelete: "cascade" })
      .notNull(),
    judgeId: uuid("judge_id")
      .references(() => judges.id, { onDelete: "cascade" })
      .notNull(),
    status: unlockRequestStatus("status").notNull().default("pending"),
    reason: text("reason"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => userProfiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("unlock_requests_pending_idx").on(table.roundId, table.judgeId),
  ],
);

export const localCredentials = pgTable("local_credentials", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => userProfiles.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  token: varchar("token", { length: 64 }).primaryKey(),
  userId: uuid("user_id")
    .references(() => userProfiles.id, { onDelete: "cascade" })
    .notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const syncOperations = pgTable(
  "sync_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    eventId: uuid("event_id").references(() => events.id, {
      onDelete: "cascade",
    }),
    actorUserId: uuid("actor_user_id").references(() => userProfiles.id, {
      onDelete: "set null",
    }),
    operationType: varchar("operation_type", { length: 80 }).notNull(),
    status: syncStatus("status").notNull().default("pending"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    lastError: text("last_error"),
    retryCount: integer("retry_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("sync_operations_idempotency_idx").on(table.idempotencyKey)],
);

// ── Automatic database backups ────────────────────────────────────────────────
// Self-hosted, local-Postgres backups driven from inside the app: a scheduler
// (see instrumentation.ts) runs `pg_dump` on an interval when enabled, and every
// run is recorded in `backup_runs` for the Settings UI to list and download.

export const backupSettings = pgTable("backup_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  enabled: boolean("enabled").notNull().default(false),
  // How often the scheduler takes a backup, in hours.
  intervalHours: integer("interval_hours").notNull().default(24),
  // Keep only the newest N backup files; older ones are pruned after each run.
  retentionCount: integer("retention_count").notNull().default(14),
  // Absolute directory where dump files are written.
  directory: text("directory").notNull(),
  // Optional explicit path to the pg_dump binary (defaults to "pg_dump" on PATH).
  pgDumpPath: text("pg_dump_path"),
  // Optional Docker container name. When set, the dump runs via
  // `docker exec <container> pg_dump …` — useful when the DB runs in Docker and
  // the host has no matching pg_dump version. When null, a local binary is used.
  dockerContainer: text("docker_container"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastStatus: varchar("last_status", { length: 20 }),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const backupRuns = pgTable(
  "backup_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    filename: text("filename").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    status: varchar("status", { length: 20 }).notNull(),
    // "manual" (Back up now) or "scheduled" (the interval scheduler).
    trigger: varchar("trigger", { length: 20 }).notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("backup_runs_org_created_idx").on(table.organizationId, table.createdAt)],
);
