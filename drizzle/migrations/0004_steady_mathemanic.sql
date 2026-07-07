ALTER TABLE "judges" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "is_manual_entry" boolean DEFAULT false NOT NULL;