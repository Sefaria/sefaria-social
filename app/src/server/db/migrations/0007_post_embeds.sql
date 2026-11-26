ALTER TABLE "posts" ADD COLUMN "embed_kind" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "embed_id" uuid;--> statement-breakpoint
CREATE INDEX "posts_embed_idx" ON "posts" USING btree ("embed_id") WHERE "posts"."embed_id" is not null;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_embed_check" CHECK (("posts"."embed_kind" is null and "posts"."embed_id" is null) or ("posts"."embed_kind" in ('room', 'broadcast', 'recording') and "posts"."embed_id" is not null));