CREATE TABLE "asset_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"bytes" integer NOT NULL,
	"manifest" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" bigint NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"lang" text,
	"source_url" text,
	"current_version_id" uuid,
	"published_version_id" uuid,
	"published_at" timestamp with time zone,
	"hidden" boolean DEFAULT false NOT NULL,
	"hidden_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_current_version_id_asset_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_published_version_id_asset_versions_id_fk" FOREIGN KEY ("published_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_versions_asset_n_idx" ON "asset_versions" USING btree ("asset_id","n");--> statement-breakpoint
CREATE INDEX "asset_versions_created_idx" ON "asset_versions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "assets_owner_user_id_idx" ON "assets" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "assets_current_version_idx" ON "assets" USING btree ("current_version_id");--> statement-breakpoint
CREATE INDEX "assets_published_version_idx" ON "assets" USING btree ("published_version_id");