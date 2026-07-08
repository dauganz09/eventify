import { z } from "zod";

export const idSchema = z.string().uuid();

export const roleSchema = z.enum([
  "owner",
  "admin",
  "tabulator",
  "judge",
  "viewer",
  "auditor",
]);

export const eventStatusSchema = z.enum([
  "draft",
  "active",
  "paused",
  "completed",
  "archived",
]);

export const criterionInputTypeSchema = z.enum([
  "numeric",
  "decimal",
  "slider",
  "rating",
  "rank",
  "boolean",
  "rubric",
  "text",
  "penalty",
  "bonus",
]);

export const eventUpsertSchema = z.object({
  organizationId: idSchema.optional(),
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2_000).optional(),
  logoUrl: z
    .union([z.string().trim().min(1).max(1000), z.literal(""), z.null()])
    .optional(),
  venue: z.string().trim().max(200).optional(),
  timezone: z.string().trim().min(1).default("UTC"),
  contestantDisplayMode: z.string().trim().min(1).default("one-at-a-time"),
  startsAt: z
    .union([z.string().trim().min(1), z.literal(""), z.null()])
    .optional(),
  endsAt: z
    .union([z.string().trim().min(1), z.literal(""), z.null()])
    .optional(),
});

export const eventUpdateSchema = eventUpsertSchema.partial().extend({
  eventId: idSchema,
});

export const eventStatusUpdateSchema = z.object({
  eventId: idSchema,
  status: eventStatusSchema,
});

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(160),
});

export const organizationUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160),
});

export const backupSettingsUpdateSchema = z.object({
  enabled: z.boolean(),
  intervalHours: z.coerce.number().int().min(1).max(720),
  retentionCount: z.coerce.number().int().min(1).max(365),
  directory: z.string().trim().min(1).max(1024),
  pgDumpPath: z.string().trim().max(1024).optional(),
  dockerContainer: z.string().trim().max(200).optional(),
});

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(200),
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "New password and confirmation do not match.",
    path: ["confirmPassword"],
  });

export const staffAccountCreateSchema = z.object({
  displayName: z.string().trim().max(160).optional(),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
});

export const roundGroupUpsertSchema = z.object({
  eventId: idSchema,
  roundGroupId: idSchema.optional(),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1_000).optional(),
  position: z.coerce.number().int().min(0).default(0),
  carryOverScores: z.coerce.boolean().default(false),
  carryOverWeight: z.coerce.number().int().min(0).max(100).default(100),
  // Advancement: only the top N contestants from previous rounds may be
  // scored in this round (null = everyone qualifies).
  advanceCount: z
    .preprocess(
      (value) => (value === "" || value === undefined ? null : value),
      z.coerce.number().int().min(1).max(1_000).nullable(),
    )
    .default(null),
  advanceDisplayOrder: z.enum(["number", "rank"]).default("number"),
  scoringMethod: z.enum(["points", "rank_order"]).default("points"),
});

export const roundUpsertSchema = z.object({
  eventId: idSchema,
  roundId: idSchema.optional(),
  roundGroupId: idSchema.optional(),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1_000).optional(),
  position: z.coerce.number().int().min(0).default(0),
  isManualEntry: z.coerce.boolean().default(false),
});

export const judgeUpsertSchema = z.object({
  eventId: idSchema,
  judgeId: idSchema.optional(),
  displayName: z.string().trim().min(1).max(160),
  username: z.string().trim().min(1).max(80).regex(/^\S+$/, "Username must have no spaces").optional().or(z.literal("")),
  password: z.string().min(4).max(128).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  isActive: z.coerce.boolean().default(true),
});

export const judgeAssignmentSchema = z.object({
  eventId: idSchema,
  judgeId: idSchema,
  /** Set-level scope (legacy granularity). */
  roundId: idSchema.optional(),
  /**
   * Round-level scope: the judge scores every set inside these round groups.
   * Empty array = event-wide (the judge scores everything). One assignment row
   * is written per group id.
   */
  roundGroupIds: z.array(idSchema).default([]),
});

export const scoringRuleUpsertSchema = z.object({
  eventId: idSchema,
  ruleId: idSchema.optional(),
  roundId: idSchema.optional(),
  name: z.string().trim().min(1).max(160),
  aggregation: z.enum([
    "sum",
    "average",
    "weighted_sum",
    "drop_high",
    "drop_low",
    "drop_high_low",
  ]),
});

export const themeUpsertSchema = z.object({
  eventId: idSchema,
  name: z.string().trim().min(1).max(120).default("Event Theme"),
  primary: z.string().trim().min(1),
  background: z.string().trim().min(1),
  foreground: z.string().trim().min(1),
});

export const displayModeSchema = z.enum([
  "list",
  "card",
  "one-at-a-time",
  "grouped",
  "stage-order",
  "table",
]);

export const contestantUpsertSchema = z.object({
  eventId: idSchema,
  displayNumber: z.string().trim().max(40).optional(),
  displayName: z.string().trim().min(1).max(200),
  category: z.string().trim().max(120).optional(),
  division: z.string().trim().max(120).optional(),
  photoUrl: z.string().trim().max(1000).optional().or(z.literal("")),
  position: z.coerce.number().int().min(0).default(0),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const criterionUpsertSchema = z.object({
  eventId: idSchema,
  roundId: idSchema.optional(),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1_000).optional(),
  inputType: criterionInputTypeSchema.default("decimal"),
  minValue: z.coerce.number().optional(),
  maxValue: z.coerce.number().optional(),
  stepValue: z.coerce.number().positive().optional(),
  weight: z.coerce.number().positive().default(100),
  position: z.coerce.number().int().min(0).default(0),
  isRequired: z.coerce.boolean().default(true),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const scoreOperationSchema = z.object({
  idempotencyKey: z.string().trim().min(12).max(160),
  deviceId: z.string().trim().min(1).max(160),
  eventId: idSchema,
  roundId: idSchema,
  contestantId: idSchema,
  criterionId: idSchema,
  judgeId: idSchema,
  value: z.coerce.number(),
  comment: z.string().trim().max(2_000).optional(),
  // Equivalent to z.string().datetime() but avoids a Turbopack production-build
  // minification bug ("Cannot access 'fl' before initialization") triggered by
  // Zod v4's .datetime() internals. Accepts the same ISO-8601 strings the
  // client outbox emits via Date.prototype.toISOString().
  clientCreatedAt: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: "Invalid datetime string.",
    }),
  expectedRevision: z.coerce.number().int().positive().optional(),
  operation: z
    .enum(["draft_saved", "submitted", "manual_adjustment"])
    .default("submitted"),
});

export type ScoreOperationInput = z.infer<typeof scoreOperationSchema>;

export const scoreBatchSchema = z
  .object({
    operations: z.array(scoreOperationSchema).min(1).max(50),
  })
  .superRefine((value, ctx) => {
    const eventIds = new Set(value.operations.map((operation) => operation.eventId));
    if (eventIds.size !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "All operations in a batch must belong to the same event.",
        path: ["operations"],
      });
    }
  });

export type ScoreBatchInput = z.infer<typeof scoreBatchSchema>;
