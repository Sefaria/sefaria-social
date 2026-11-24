-- Spec 032: a post may share a live follow-me session (the reader's session id). Additive: one nullable column.
ALTER TABLE "posts" ADD COLUMN "follow_session_id" text;