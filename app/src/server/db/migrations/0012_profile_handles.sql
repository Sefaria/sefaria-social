-- Spec 057: each profile's @handle. The column is added empty ('' is "not yet given", the default the trigger replaces), the
-- unique index is built (partial, so the empty ones do not clash, and so the backfill's lookups use it), every existing
-- profile is given one (oldest first), and a trigger gives each new profile one.
ALTER TABLE "profiles" ADD COLUMN "handle" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_handle_idx" ON "profiles" USING btree (lower("handle")) WHERE "profiles"."handle" <> '';--> statement-breakpoint
-- A free handle made from a name: a–z 0–9 and "_" (accents are not dropped: "José" gives "jos"), starting with a letter;
-- "learner" when too little is left, or for a person whose name starts with a word only staff may use; "_" after a reserved
-- word for a profile staff made. On a clash 2, 3 and 4 are tried, then random six-digit numbers, so a common base ("learner"
-- for every Hebrew-only name) costs a few lookups, not one per profile that has it. The rules for a handle someone chooses are
-- in app/src/server/services/handles.ts.
CREATE FUNCTION social_free_handle(name text, kind text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  base text;
  want text;
  n int := 1;
BEGIN
  base := regexp_replace(lower(left(coalesce(name, ''), 200)), '[^a-z0-9]+', '_', 'g');
  base := regexp_replace(base, '^[_0-9]+|_+$', '', 'g');
  base := regexp_replace(left(base, 24), '_+$', '');
  IF length(base) < 3 OR (kind = 'person' AND base ~ '^(sefaria|admin|staff|support|system|root|official)') THEN
    base := 'learner';
  ELSIF base IN ('admin', 'administrator', 'api', 'help', 'me', 'null', 'root', 'sefaria', 'settings', 'social', 'staff',
                 'support', 'system', 'undefined', 'official') THEN
    base := base || '_';
  END IF;
  LOOP
    want := CASE
      WHEN n = 1 THEN base
      WHEN n <= 4 THEN base || n::text
      ELSE base || (100000 + floor(random() * 900000))::int::text
    END;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM profiles WHERE lower(handle) = want AND handle <> '');
    n := n + 1;
  END LOOP;
  RETURN want;
END $$;
--> statement-breakpoint
-- Every new profile gets one, however it is made (Social, staff SQL, the demo seed).
CREATE FUNCTION social_profile_handle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.handle IS NULL OR NEW.handle = '' THEN
    NEW.handle := social_free_handle(NEW.name, NEW.kind);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER profiles_handle_trigger BEFORE INSERT ON profiles FOR EACH ROW EXECUTE FUNCTION social_profile_handle();
--> statement-breakpoint
-- Existing profiles, oldest first.
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN SELECT id, name, kind FROM profiles WHERE handle = '' ORDER BY created_at, id LOOP
    UPDATE profiles SET handle = social_free_handle(p.name, p.kind) WHERE id = p.id;
  END LOOP;
END $$;
