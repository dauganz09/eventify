CREATE TYPE "public"."round_lifecycle" AS ENUM('idle', 'active', 'finished');--> statement-breakpoint
CREATE TYPE "public"."unlock_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "judge_sessions" (
	"token" varchar(64) PRIMARY KEY NOT NULL,
	"judge_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "judge_set_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"judge_id" uuid NOT NULL,
	"finalized_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "round_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "round_lifecycle" DEFAULT 'idle' NOT NULL,
	"carry_over_scores" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unlock_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"judge_id" uuid NOT NULL,
	"status" "unlock_request_status" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "judges" ADD COLUMN "username" varchar(80);--> statement-breakpoint
ALTER TABLE "judges" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "round_group_id" uuid;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "status" "round_lifecycle" DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "carry_over_scores" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "judge_sessions" ADD CONSTRAINT "judge_sessions_judge_id_judges_id_fk" FOREIGN KEY ("judge_id") REFERENCES "public"."judges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_sessions" ADD CONSTRAINT "judge_sessions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_set_submissions" ADD CONSTRAINT "judge_set_submissions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_set_submissions" ADD CONSTRAINT "judge_set_submissions_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_set_submissions" ADD CONSTRAINT "judge_set_submissions_judge_id_judges_id_fk" FOREIGN KEY ("judge_id") REFERENCES "public"."judges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_groups" ADD CONSTRAINT "round_groups_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlock_requests" ADD CONSTRAINT "unlock_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlock_requests" ADD CONSTRAINT "unlock_requests_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlock_requests" ADD CONSTRAINT "unlock_requests_judge_id_judges_id_fk" FOREIGN KEY ("judge_id") REFERENCES "public"."judges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlock_requests" ADD CONSTRAINT "unlock_requests_resolved_by_user_profiles_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "judge_set_submissions_unique_idx" ON "judge_set_submissions" USING btree ("round_id","judge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unlock_requests_pending_idx" ON "unlock_requests" USING btree ("round_id","judge_id");--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_round_group_id_round_groups_id_fk" FOREIGN KEY ("round_group_id") REFERENCES "public"."round_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "judges_username_unique_idx" ON "judges" USING btree ("username") WHERE "judges"."username" IS NOT NULL;