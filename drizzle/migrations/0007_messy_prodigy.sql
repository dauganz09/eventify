ALTER TABLE "score_events" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "score_events" ADD COLUMN "prev_hash" text;--> statement-breakpoint
ALTER TABLE "score_events" ADD COLUMN "hash" text;--> statement-breakpoint
CREATE INDEX "score_events_event_seq_idx" ON "score_events" USING btree ("event_id","seq");