CREATE TYPE "public"."tie_break_method" AS ENUM('manual', 'judge_vote');--> statement-breakpoint
CREATE TYPE "public"."tie_break_scope" AS ENUM('standings', 'advancement', 'rank_order');--> statement-breakpoint
CREATE TABLE "tie_breaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"scope" "tie_break_scope" NOT NULL,
	"context_id" uuid,
	"tied_contestant_ids" jsonb NOT NULL,
	"resolved_order" jsonb NOT NULL,
	"method" "tie_break_method" DEFAULT 'manual' NOT NULL,
	"note" text,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tie_breaks" ADD CONSTRAINT "tie_breaks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tie_breaks" ADD CONSTRAINT "tie_breaks_resolved_by_user_id_user_profiles_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE set null ON UPDATE no action;