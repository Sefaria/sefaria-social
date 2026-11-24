CREATE TABLE "broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"host_user_id" bigint NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "broadcasts_status_check" CHECK ("broadcasts"."status" in ('live', 'ended'))
);
--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcasts_room_idx" ON "broadcasts" USING btree ("room_id","started_at");--> statement-breakpoint
CREATE INDEX "broadcasts_host_user_id_idx" ON "broadcasts" USING btree ("host_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "broadcasts_one_live_idx" ON "broadcasts" USING btree ("room_id") WHERE "broadcasts"."status" = 'live';