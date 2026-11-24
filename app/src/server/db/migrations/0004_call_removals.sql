CREATE TABLE "call_removals" (
	"room_id" uuid NOT NULL,
	"user_id" bigint NOT NULL,
	"until" timestamp with time zone NOT NULL,
	CONSTRAINT "call_removals_room_id_user_id_pk" PRIMARY KEY("room_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "call_removals" ADD CONSTRAINT "call_removals_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_removals_user_id_idx" ON "call_removals" USING btree ("user_id");