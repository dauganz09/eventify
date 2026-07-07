ALTER TABLE "round_groups" ADD COLUMN "advance_count" integer;--> statement-breakpoint
ALTER TABLE "round_groups" ADD COLUMN "advance_display_order" varchar(20) DEFAULT 'number' NOT NULL;--> statement-breakpoint
ALTER TABLE "round_groups" ADD COLUMN "scoring_method" varchar(20) DEFAULT 'points' NOT NULL;--> statement-breakpoint
ALTER TABLE "round_groups" ADD COLUMN "qualified_contestant_ids" jsonb;