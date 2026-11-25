-- Spec 051 (docs/plans/shiur.md D12): recordings made before media moved to the object store are test data; they are deleted,
-- with their state chunks (on delete cascade), and the media chunk table goes.
-- contract: the owner allowed deleting every recording made before this (D12, 2026-11-25); nothing in this release reads or
-- writes recording_media_chunks, and a recorder of the release before fails its upload during the deploy, as a network error would.
DELETE FROM "session_recordings";--> statement-breakpoint
DROP TABLE "recording_media_chunks" CASCADE;--> statement-breakpoint
ALTER TABLE "session_recordings" ADD COLUMN "media_chunks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "session_recordings" ADD COLUMN "last_chunk_sha256" text;