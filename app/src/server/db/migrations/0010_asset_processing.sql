ALTER TABLE "session_recordings" ADD COLUMN "process_status" text;--> statement-breakpoint
ALTER TABLE "session_recordings" ADD COLUMN "process_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "session_recordings" ADD COLUMN "process_after" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "session_recordings_process_idx" ON "session_recordings" USING btree ("process_after") WHERE "session_recordings"."process_status" in ('queued', 'running');--> statement-breakpoint
ALTER TABLE "session_recordings" ADD CONSTRAINT "session_recordings_process_status_check" CHECK ("session_recordings"."process_status" is null or "session_recordings"."process_status" in ('queued', 'running', 'done', 'failed'));