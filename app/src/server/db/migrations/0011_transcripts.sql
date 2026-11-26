ALTER TABLE "session_recordings" ADD COLUMN "transcript_status" text;--> statement-breakpoint
ALTER TABLE "session_recordings" ADD COLUMN "transcript_language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "session_recordings" ADD COLUMN "transcript_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "session_recordings" ADD COLUMN "transcript_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session_recordings" ADD COLUMN "transcript_job_id" text;--> statement-breakpoint
ALTER TABLE "session_recordings" ADD COLUMN "transcript_submitted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "session_recordings_transcript_idx" ON "session_recordings" USING btree ("transcript_after") WHERE "session_recordings"."transcript_status" in ('queued', 'submitted');--> statement-breakpoint
ALTER TABLE "session_recordings" ADD CONSTRAINT "session_recordings_transcript_status_check" CHECK ("session_recordings"."transcript_status" is null or "session_recordings"."transcript_status" in ('queued', 'submitted', 'ready', 'failed', 'unavailable'));--> statement-breakpoint
ALTER TABLE "session_recordings" ADD CONSTRAINT "session_recordings_transcript_language_check" CHECK ("session_recordings"."transcript_language" in ('en', 'he', 'yi', 'fr'));