/**
 * Seeds the "Miss Carigara 2026" event configuration: round groups (rounds),
 * rounds (sets), criteria, and scoring rules. No contestants and no judges —
 * add those in the app afterwards.
 *
 * The data is a snapshot of the live event taken on 2026-07-06. All run-of-show
 * state is reset (groups/sets idle and unlocked, no qualified-contestant
 * snapshot) so the event is ready to run from the top.
 *
 * Usage:
 *   npm run db:seed             # aborts if the event already exists
 *   npm run db:seed -- --force  # deletes the existing event (including any
 *                               # contestants/judges/scores under it!) first
 *
 * Reads DATABASE_URL from the environment or .env.local. Requires at least one
 * signed-up user: sign up / log in once in the app first so an organization
 * exists to own the event.
 */
import { readFileSync, existsSync } from "node:fs";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";

// ── Snapshot data ───────────────────────────────────────────────────────────

const EVENT = {
  id: "278d8b25-964b-4d2f-b67b-1aea450936ad",
  name: "Miss Carigara 2026",
  description:
    "Official Miss Carigara pageant — points-based rounds, top-5 final by rank order.",
  venue: "LGU Grounds / Kan Gara Gymnasium",
  logoUrl: "/uploads/events/4a7199c1-8643-4ca7-84a0-5a92741ce250.png",
  timezone: "UTC",
  status: "active" as const,
  contestantDisplayMode: "one-at-a-time",
  resultVisibility: {} as Record<string, unknown>,
  config: { tieBreak: "shared", roundScoreMode: "sum" } as Record<string, unknown>,
  startsAt: new Date("2026-07-03T11:00:00+00:00"),
  endsAt: new Date("2026-07-03T04:59:00+00:00"),
};

// UI "rounds" (round_groups table).
const ROUND_GROUPS = [
  {
    id: "4dec4b17-8cfd-47d6-9018-7714045a2ecd",
    name: "Pre-judging",
    description: "Talent + Denim Jeans Wear + Preliminary Q&A (30 pts)",
    position: 0,
    carryOverScores: true,
    carryOverWeight: 100,
    advanceCount: null,
    advanceDisplayOrder: "number",
    scoringMethod: "points",
  },
  {
    id: "d49b139f-921c-41ca-bd00-b0d56ed41756",
    name: "Closed Door Interview",
    description: "Advocacy + Closed Door Interview (30 pts)",
    position: 1,
    carryOverScores: true,
    carryOverWeight: 100,
    advanceCount: null,
    advanceDisplayOrder: "number",
    scoringMethod: "points",
  },
  {
    id: "d37c4803-c456-45d6-ab86-aa46b9013f45",
    name: "Coronation Night",
    description: "Production Attire + Swimsuit + Gown (40 pts)",
    position: 2,
    carryOverScores: true,
    carryOverWeight: 100,
    advanceCount: null,
    advanceDisplayOrder: "number",
    scoringMethod: "points",
  },
  {
    id: "17ba9f71-6ed8-4869-9d27-393b0b92e38e",
    name: "Question and Answer",
    description: "Final round — top 5 only, rank order decides the winner (10 pts)",
    position: 3,
    carryOverScores: false,
    carryOverWeight: 100,
    advanceCount: 5,
    advanceDisplayOrder: "number",
    scoringMethod: "rank_order",
  },
];

// UI "sets" (rounds table).
const ROUNDS = [
  {
    id: "8bc7de0f-9ad6-4c93-975e-75dc6c93b0e2",
    roundGroupId: "4dec4b17-8cfd-47d6-9018-7714045a2ecd",
    name: "Talent",
    description: "10 points",
    position: 0,
    carryOverScores: true,
  },
  {
    id: "133ef3a3-43f2-49d1-8ce5-28f19b121cd5",
    roundGroupId: "4dec4b17-8cfd-47d6-9018-7714045a2ecd",
    name: "Denim Jeans Wear",
    description: "10 points — straight scoring",
    position: 1,
    carryOverScores: true,
  },
  {
    id: "88c57607-cf6b-4f10-bbba-c0a1c4b823d9",
    roundGroupId: "4dec4b17-8cfd-47d6-9018-7714045a2ecd",
    name: "Preliminary Q & A",
    description: "10 points — straight scoring",
    position: 2,
    carryOverScores: true,
  },
  {
    id: "40b2d6de-0730-47ce-bf6b-f9310a446cd8",
    roundGroupId: "d49b139f-921c-41ca-bd00-b0d56ed41756",
    name: "Advocacy",
    description: "10 points",
    position: 3,
    carryOverScores: true,
  },
  {
    id: "473bdf2b-c2b0-4c06-8ef3-a979cbfd8880",
    roundGroupId: "d49b139f-921c-41ca-bd00-b0d56ed41756",
    name: "Closed Door Interview",
    description: "20 points",
    position: 4,
    carryOverScores: true,
  },
  {
    id: "f59d5c98-997e-43ed-9035-8c3bad2dc1cb",
    roundGroupId: "d37c4803-c456-45d6-ab86-aa46b9013f45",
    name: "Production Attire",
    description: "Poise and bearing, mastery, self-introduction — 10 points",
    position: 5,
    carryOverScores: true,
  },
  {
    id: "1119cbde-8648-45c8-a7fb-e29d298f870d",
    roundGroupId: "d37c4803-c456-45d6-ab86-aa46b9013f45",
    name: "Swimsuit",
    description: "Stage presence, poise and bearing, beauty of figure — 15 points",
    position: 6,
    carryOverScores: true,
  },
  {
    id: "3772db30-8c6b-4f5c-b1ab-2d3404eb7ca5",
    roundGroupId: "d37c4803-c456-45d6-ab86-aa46b9013f45",
    name: "Gown",
    description: "Design and fitting, poise and bearing, stage presence — 15 points",
    position: 7,
    carryOverScores: true,
  },
  {
    id: "7ff4d4d3-a7a8-4d08-bc3e-332f8e0ceda2",
    roundGroupId: "17ba9f71-6ed8-4869-9d27-393b0b92e38e",
    name: "Question and Answer",
    description: "10 points",
    position: 8,
    carryOverScores: false,
  },
];

// Numeric columns (min/max/step/weight) are Drizzle `numeric` — pass strings.
const CRITERIA = [
  {
    id: "6ed9852d-ffab-4746-b4f9-2cac04654de4",
    roundId: "8bc7de0f-9ad6-4c93-975e-75dc6c93b0e2",
    name: "Execution",
    description: "5 points",
    minValue: "3.00",
    maxValue: "5.00",
    position: 0,
  },
  {
    id: "281c697b-cb91-4adb-ab29-a33ce2fbf97d",
    roundId: "8bc7de0f-9ad6-4c93-975e-75dc6c93b0e2",
    name: "Creativity and Originality",
    description: "3 points — straight scoring",
    minValue: "2.00",
    maxValue: "3.00",
    position: 1,
  },
  {
    id: "6c19ae0a-ca6c-4cb0-934b-75d0481f2fa5",
    roundId: "8bc7de0f-9ad6-4c93-975e-75dc6c93b0e2",
    name: "Stage Presence & Overall Performance",
    description: "2 points — straight scoring",
    minValue: "1.00",
    maxValue: "2.00",
    position: 2,
  },
  {
    id: "2e7ccb93-b133-48a3-a8a3-b0b32c2360c6",
    roundId: "133ef3a3-43f2-49d1-8ce5-28f19b121cd5",
    name: "Denim Jeans Wear",
    description: "10 points — straight scoring",
    minValue: "6.00",
    maxValue: "10.00",
    position: 3,
  },
  {
    id: "b8c43b5d-3614-4624-8a02-103d50b87ce9",
    roundId: "88c57607-cf6b-4f10-bbba-c0a1c4b823d9",
    name: "Preliminary Q & A",
    description: "10 points — straight scoring",
    minValue: "6.00",
    maxValue: "10.00",
    position: 4,
  },
  {
    id: "84b00cb8-8069-4736-9505-48a08223015f",
    roundId: "40b2d6de-0730-47ce-bf6b-f9310a446cd8",
    name: "Content, Substance and Overall Presentation of Message",
    description: "3 points",
    minValue: "2.00",
    maxValue: "3.00",
    position: 5,
  },
  {
    id: "9c42813b-df29-4ad4-a59e-04076f12120f",
    roundId: "40b2d6de-0730-47ce-bf6b-f9310a446cd8",
    name: "Mastery, Proficiency and Effective Delivery",
    description: "5 points",
    minValue: "3.00",
    maxValue: "5.00",
    position: 6,
  },
  {
    id: "50db5b07-5d87-46aa-87fb-3f124b23badb",
    roundId: "40b2d6de-0730-47ce-bf6b-f9310a446cd8",
    name: "Creativity / Originality",
    description: "2 points",
    minValue: "1.00",
    maxValue: "2.00",
    position: 7,
  },
  {
    id: "89bea08c-f658-42e6-9ca0-332eb83d2547",
    roundId: "473bdf2b-c2b0-4c06-8ef3-a979cbfd8880",
    name: "Poise and Grace",
    description: "2 points",
    minValue: "1.00",
    maxValue: "2.00",
    position: 8,
  },
  {
    id: "194136f4-7730-4fbb-b3f8-dccd26ec9bc5",
    roundId: "473bdf2b-c2b0-4c06-8ef3-a979cbfd8880",
    name: "Personality and Communication Skills",
    description: "8 points",
    minValue: "5.00",
    maxValue: "8.00",
    position: 9,
  },
  {
    id: "233e88f3-5d2e-4ecb-89e2-259add8ae899",
    roundId: "473bdf2b-c2b0-4c06-8ef3-a979cbfd8880",
    name: "Personal Appearance",
    description: "Beauty of face and body, overall qualities and attributes — 4 points",
    minValue: "2.00",
    maxValue: "4.00",
    position: 10,
  },
  {
    id: "0dd0bbe2-bd59-4b9a-b50b-d5f922094c75",
    roundId: "473bdf2b-c2b0-4c06-8ef3-a979cbfd8880",
    name: "Intelligence",
    description: "6 points",
    minValue: "4.00",
    maxValue: "6.00",
    position: 11,
  },
  {
    id: "d3d47764-2b6d-4a03-be64-71d361e2f9d6",
    roundId: "f59d5c98-997e-43ed-9035-8c3bad2dc1cb",
    name: "Production Attire",
    description: "Poise and bearing, mastery, self-introduction — 10 points",
    minValue: "6.00",
    maxValue: "10.00",
    position: 12,
  },
  {
    id: "42cc0de4-8323-42b3-b4d6-d76d3ef09864",
    roundId: "1119cbde-8648-45c8-a7fb-e29d298f870d",
    name: "Swimsuit",
    description: "Stage presence, poise and bearing, beauty of figure — 15 points",
    minValue: "9.00",
    maxValue: "15.00",
    position: 13,
  },
  {
    id: "5bbe8565-0aad-48db-85aa-4bfdcedd87f5",
    roundId: "3772db30-8c6b-4f5c-b1ab-2d3404eb7ca5",
    name: "Gown",
    description: "Design and fitting, poise and bearing, stage presence — 15 points",
    minValue: "9.00",
    maxValue: "15.00",
    position: 14,
  },
  {
    id: "0d15eaaf-a6a6-41d4-8da7-c5fa68ebaa34",
    roundId: "7ff4d4d3-a7a8-4d08-bc3e-332f8e0ceda2",
    name: "Beauty of Face and Figure",
    description: "3 points",
    minValue: "2.00",
    maxValue: "3.00",
    position: 15,
  },
  {
    id: "f011a9b6-6b79-490b-8173-64fb94089b72",
    roundId: "7ff4d4d3-a7a8-4d08-bc3e-332f8e0ceda2",
    name: "Wit and Content",
    description: "5 points",
    minValue: "3.00",
    maxValue: "5.00",
    position: 16,
  },
  {
    id: "8590f7e6-1bb3-4532-8075-d4b58301d082",
    roundId: "7ff4d4d3-a7a8-4d08-bc3e-332f8e0ceda2",
    name: "Poise and Bearing",
    description: "2 points",
    minValue: "1.00",
    maxValue: "2.00",
    position: 17,
  },
];

const SCORING_RULES = [
  {
    id: "fa01c1df-7ff6-481f-8faa-cbf3dd9a3534",
    roundId: null,
    name: "Average across judges",
    aggregation: "average",
  },
];

// ── Runner ──────────────────────────────────────────────────────────────────

function loadEnvLocal() {
  if (process.env.DATABASE_URL || !existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

async function main() {
  loadEnvLocal();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set (checked the environment and .env.local).");
  }
  const force = process.argv.includes("--force");

  const client = postgres(connectionString, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });

  try {
    const [organization] = await db
      .select()
      .from(schema.organizations)
      .orderBy(asc(schema.organizations.createdAt))
      .limit(1);
    if (!organization) {
      throw new Error(
        "No organization found. Open the app and sign up / log in once first — " +
          "that creates your organization — then re-run the seed.",
      );
    }

    const [existing] = await db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(eq(schema.events.id, EVENT.id))
      .limit(1);
    if (existing) {
      if (!force) {
        throw new Error(
          `Event "${EVENT.name}" already exists. Re-run with --force to delete it ` +
            "(including any contestants, judges, and scores added under it) and re-seed:\n" +
            "  npm run db:seed -- --force",
        );
      }
      console.log(`Deleting existing "${EVENT.name}" event (--force)...`);
      await db.delete(schema.events).where(eq(schema.events.id, EVENT.id));
    }

    await db.transaction(async (tx) => {
      await tx.insert(schema.events).values({
        ...EVENT,
        organizationId: organization.id,
      });
      await tx.insert(schema.roundGroups).values(
        ROUND_GROUPS.map((group) => ({
          ...group,
          eventId: EVENT.id,
          status: "idle" as const,
          qualifiedContestantIds: null,
        })),
      );
      await tx.insert(schema.rounds).values(
        ROUNDS.map((round) => ({
          ...round,
          eventId: EVENT.id,
          status: "idle" as const,
          isLocked: false,
          isManualEntry: false,
          config: {},
        })),
      );
      await tx.insert(schema.criteria).values(
        CRITERIA.map((criterion) => ({
          ...criterion,
          eventId: EVENT.id,
          inputType: "decimal",
          stepValue: "0.10",
          weight: "100",
          isRequired: true,
          config: {},
        })),
      );
      await tx.insert(schema.scoringRules).values(
        SCORING_RULES.map((rule) => ({ ...rule, eventId: EVENT.id, config: {} })),
      );
    });

    console.log(`Seeded "${EVENT.name}" into organization "${organization.name}":`);
    console.log(`  ${ROUND_GROUPS.length} rounds (groups)`);
    console.log(`  ${ROUNDS.length} sets`);
    console.log(`  ${CRITERIA.length} criteria`);
    console.log(`  ${SCORING_RULES.length} scoring rule(s)`);
    console.log(
      "No contestants or judges were created — add them in the app. " +
        "The event logo expects public/uploads/events/ to be copied along with the project.",
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
