CREATE TYPE "public"."tie_break_vote_status" AS ENUM('open', 'resolved', 'cancelled');--> statement-breakpoint
CREATE TABLE "tie_break_ballots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vote_id" uuid NOT NULL,
	"judge_id" uuid NOT NULL,
	"ordered_contestant_ids" jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tie_break_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"scope" "tie_break_scope" NOT NULL,
	"context_id" uuid,
	"tied_contestant_ids" jsonb NOT NULL,
	"eligible_judge_ids" jsonb NOT NULL,
	"status" "tie_break_vote_status" DEFAULT 'open' NOT NULL,
	"opened_by_user_id" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tie_break_ballots" ADD CONSTRAINT "tie_break_ballots_vote_id_tie_break_votes_id_fk" FOREIGN KEY ("vote_id") REFERENCES "public"."tie_break_votes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tie_break_ballots" ADD CONSTRAINT "tie_break_ballots_judge_id_judges_id_fk" FOREIGN KEY ("judge_id") REFERENCES "public"."judges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tie_break_votes" ADD CONSTRAINT "tie_break_votes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tie_break_votes" ADD CONSTRAINT "tie_break_votes_opened_by_user_id_user_profiles_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tie_break_ballots_vote_judge_idx" ON "tie_break_ballots" USING btree ("vote_id","judge_id");