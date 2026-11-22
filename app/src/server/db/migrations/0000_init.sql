CREATE TABLE "deleted_users" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" text
);
--> statement-breakpoint
CREATE TABLE "room_members" (
	"room_id" uuid NOT NULL,
	"user_id" bigint NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_members_room_id_user_id_pk" PRIMARY KEY("room_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" bigint NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shiur_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shiur_id" uuid NOT NULL,
	"owner_user_id" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"duration_ms" integer,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shiurim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid,
	"teacher_user_id" bigint NOT NULL,
	"title" text NOT NULL,
	"ref" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_display" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"img" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_receipts" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shiur_recordings" ADD CONSTRAINT "shiur_recordings_shiur_id_shiurim_id_fk" FOREIGN KEY ("shiur_id") REFERENCES "public"."shiurim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shiurim" ADD CONSTRAINT "shiurim_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_members_user_id_idx" ON "room_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rooms_owner_user_id_idx" ON "rooms" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "shiur_recordings_shiur_id_idx" ON "shiur_recordings" USING btree ("shiur_id");--> statement-breakpoint
CREATE INDEX "shiur_recordings_owner_user_id_idx" ON "shiur_recordings" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "shiurim_room_id_idx" ON "shiurim" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "shiurim_teacher_user_id_idx" ON "shiurim" USING btree ("teacher_user_id");