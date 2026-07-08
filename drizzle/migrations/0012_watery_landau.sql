ALTER TABLE "judge_sessions" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
UPDATE "judge_sessions" AS js
SET "organization_id" = e."organization_id"
FROM "events" AS e
WHERE e."id" = js."event_id";--> statement-breakpoint
ALTER TABLE "judge_sessions" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "judge_sessions" ADD CONSTRAINT "judge_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "score_records_event_status_idx" ON "score_records" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "score_records_event_round_status_idx" ON "score_records" USING btree ("event_id","round_id","status");
