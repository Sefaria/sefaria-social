CREATE TABLE "asset_refs" (
	"asset_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"segment_ref" text NOT NULL,
	"section_ref" text NOT NULL,
	"source_ref" text NOT NULL,
	"label" text,
	"position" integer NOT NULL,
	CONSTRAINT "asset_refs_asset_id_position_pk" PRIMARY KEY("asset_id","position")
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "verified_by" text;--> statement-breakpoint
ALTER TABLE "asset_refs" ADD CONSTRAINT "asset_refs_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_refs" ADD CONSTRAINT "asset_refs_version_id_asset_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."asset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_refs_version_idx" ON "asset_refs" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "asset_refs_segment_idx" ON "asset_refs" USING btree ("segment_ref");--> statement-breakpoint
CREATE INDEX "asset_refs_section_idx" ON "asset_refs" USING btree ("section_ref");