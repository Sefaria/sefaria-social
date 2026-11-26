CREATE TABLE "shiur_assets" (
	"shiur_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shiur_assets_shiur_id_asset_id_pk" PRIMARY KEY("shiur_id","asset_id")
);
--> statement-breakpoint
ALTER TABLE "posts" DROP CONSTRAINT "posts_embed_check";--> statement-breakpoint
ALTER TABLE "session_recordings" ADD COLUMN "shiur_id" uuid;--> statement-breakpoint
ALTER TABLE "shiur_assets" ADD CONSTRAINT "shiur_assets_shiur_id_shiurim_id_fk" FOREIGN KEY ("shiur_id") REFERENCES "public"."shiurim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shiur_assets" ADD CONSTRAINT "shiur_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shiur_assets" ADD CONSTRAINT "shiur_assets_version_id_asset_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."asset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shiur_assets_asset_idx" ON "shiur_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "shiur_assets_version_idx" ON "shiur_assets" USING btree ("version_id");--> statement-breakpoint
ALTER TABLE "session_recordings" ADD CONSTRAINT "session_recordings_shiur_id_shiurim_id_fk" FOREIGN KEY ("shiur_id") REFERENCES "public"."shiurim"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_recordings_shiur_idx" ON "session_recordings" USING btree ("shiur_id");--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_embed_check" CHECK (("posts"."embed_kind" is null and "posts"."embed_id" is null) or ("posts"."embed_kind" in ('room', 'broadcast', 'recording', 'asset') and "posts"."embed_id" is not null));