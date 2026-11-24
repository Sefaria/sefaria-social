-- Reposts and quotes (spec 030): a reposts table and posts.quoted_post_id. Additive only.
CREATE TABLE "reposts" (
	"post_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"created_by_user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reposts_post_id_profile_id_pk" PRIMARY KEY("post_id","profile_id")
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "quoted_post_id" uuid;--> statement-breakpoint
ALTER TABLE "reposts" ADD CONSTRAINT "reposts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reposts" ADD CONSTRAINT "reposts_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reposts_profile_created_idx" ON "reposts" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX "reposts_created_by_idx" ON "reposts" USING btree ("created_by_user_id");--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_quoted_post_id_posts_id_fk" FOREIGN KEY ("quoted_post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posts_quoted_idx" ON "posts" USING btree ("quoted_post_id");