CREATE TABLE "room_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"inviter_user_id" bigint NOT NULL,
	"invitee_user_id" bigint,
	"email_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_invites_target_check" CHECK (("room_invites"."invitee_user_id" is not null and "room_invites"."email_sha256" is null) or ("room_invites"."invitee_user_id" is null and "room_invites"."email_sha256" is not null))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "room_id" uuid;--> statement-breakpoint
ALTER TABLE "room_invites" ADD CONSTRAINT "room_invites_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_invites_inviter_idx" ON "room_invites" USING btree ("inviter_user_id","created_at");--> statement-breakpoint
CREATE INDEX "room_invites_invitee_idx" ON "room_invites" USING btree ("room_id","invitee_user_id","created_at");--> statement-breakpoint
CREATE INDEX "room_invites_email_idx" ON "room_invites" USING btree ("room_id","email_sha256","created_at");--> statement-breakpoint
CREATE INDEX "room_invites_invitee_user_idx" ON "room_invites" USING btree ("invitee_user_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_room_idx" ON "notifications" USING btree ("room_id");