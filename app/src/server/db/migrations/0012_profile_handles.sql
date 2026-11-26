-- Spec 057: each profile's @handle. The column is added empty, every existing profile is given one (oldest first), then the
-- unique index and the trigger that gives each new profile one. '' is "not yet given": the default, which the trigger replaces.
ALTER TABLE "profiles" ADD COLUMN "handle" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Spec 057: a free handle made from a name: a–z 0–9 and "_" (accents are not dropped: "José" gives "jos"), starting with a
-- letter, "learner" when too little is left, "_" after a reserved word, then 2, 3, … added until no profile has it. The rules
-- for a handle someone chooses are in app/src/server/services/handles.ts.
CREATE FUNCTION social_free_handle(name text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  base text;
  want text;
  n int := 1;
BEGIN
  base := regexp_replace(lower(left(coalesce(name, ''), 200)), '[^a-z0-9]+', '_', 'g');
  base := regexp_replace(base, '^[_0-9]+|_+$', '', 'g');
  base := regexp_replace(left(base, 26), '_+$', '');
  IF length(base) < 3 THEN
    base := 'learner';
  ELSIF base IN ('admin', 'administrator', 'api', 'help', 'me', 'null', 'root', 'sefaria', 'settings', 'social', 'staff',
                 'support', 'system', 'undefined') THEN
    base := base || '_';
  END IF;
  LOOP
    want := CASE WHEN n = 1 THEN base ELSE left(base, 30 - length(n::text)) || n::text END;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM profiles WHERE lower(handle) = want);
    n := n + 1;
  END LOOP;
  RETURN want;
END $$;
--> statement-breakpoint
-- Every new profile gets one, however it is made (Social, staff SQL, the demo seed).
CREATE FUNCTION social_profile_handle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.handle IS NULL OR NEW.handle = '' THEN
    NEW.handle := social_free_handle(NEW.name);
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
  FOR p IN SELECT id, name FROM profiles WHERE handle = '' ORDER BY created_at, id LOOP
    UPDATE profiles SET handle = social_free_handle(p.name) WHERE id = p.id;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_handle_idx" ON "profiles" USING btree (lower("handle"));
