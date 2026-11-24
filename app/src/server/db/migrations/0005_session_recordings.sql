CREATE TABLE "recording_media_chunks" (
	"recording_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	CONSTRAINT "recording_media_chunks_recording_id_seq_pk" PRIMARY KEY("recording_id","seq")
);
--> statement-breakpoint
CREATE TABLE "recording_state_chunks" (
	"recording_id" uuid NOT NULL,
	"first_seq" integer NOT NULL,
	"last_seq" integer NOT NULL,
	"messages" jsonb NOT NULL,
	CONSTRAINT "recording_state_chunks_recording_id_first_seq_pk" PRIMARY KEY("recording_id","first_seq")
);
--> statement-breakpoint
CREATE TABLE "session_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"owner_user_id" bigint NOT NULL,
	"title" text,
	"status" text DEFAULT 'recording' NOT NULL,
	"mime" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"last_upload_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer,
	"media_bytes" bigint DEFAULT 0 NOT NULL,
	"state_messages" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_recordings_status_check" CHECK ("session_recordings"."status" in ('recording', 'ready', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "recording_media_chunks" ADD CONSTRAINT "recording_media_chunks_recording_id_session_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."session_recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_state_chunks" ADD CONSTRAINT "recording_state_chunks_recording_id_session_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."session_recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recordings" ADD CONSTRAINT "session_recordings_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_recordings_room_idx" ON "session_recordings" USING btree ("room_id","created_at");--> statement-breakpoint
CREATE INDEX "session_recordings_owner_user_id_idx" ON "session_recordings" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_recordings_one_running_idx" ON "session_recordings" USING btree ("room_id") WHERE "session_recordings"."status" = 'recording';