CREATE TABLE "live_status" (
	"relay_room" text PRIMARY KEY NOT NULL,
	"room_id" uuid NOT NULL,
	"ref" text,
	"he_ref" text,
	"title" text,
	"participants" integer DEFAULT 0 NOT NULL,
	"reported_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "live_status" ADD CONSTRAINT "live_status_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "live_status_room_idx" ON "live_status" USING btree ("room_id");