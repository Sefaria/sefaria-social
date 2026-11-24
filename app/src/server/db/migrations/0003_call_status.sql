CREATE TABLE "call_status" (
	"room_id" uuid PRIMARY KEY NOT NULL,
	"live" boolean DEFAULT false NOT NULL,
	"participants" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_status" ADD CONSTRAINT "call_status_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;