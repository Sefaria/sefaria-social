// Walk-the-schema deletion check (plan section 6.3, spec 008). `seedEveryTable` writes rows for two users into every table;
// `uncoveredTables` reports tables the seed did not reach (so a new table fails until it is seeded and its user columns are
// deleted); `userValues` looks at EVERY column of EVERY table in the public schema, as text and inside JSON, for a value
// equal to the user id. Column names do not matter, so a user id stored under any name is found.
type Sql = <R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<R[]>;

/** Seed rows for users `a` and `b`, linked both ways, plus system rows. Returns the tables written. */
export async function seedEveryTable(sql: Sql, a: number, b: number, unrelated: number): Promise<string[]> {
  const written = new Set<string>();
  for (const [user, other] of [
    [a, b],
    [b, a],
  ] as const) {
    await sql("insert into user_display (user_id, name, img) values ($1, 'Seed Learner', 'https://www.sefaria.test/u.png')", [
      user,
    ]);
    const [room] = await sql<{ id: string }>("insert into rooms (owner_user_id, title) values ($1, 'Seed room') returning id", [
      user,
    ]);
    await sql("insert into room_members (room_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member')", [
      room!.id,
      user,
      other,
    ]);
    const [shiur] = await sql<{ id: string }>(
      "insert into shiurim (room_id, teacher_user_id, title, ref, visibility) values ($1, $2, 'Seed shiur', 'Berakhot 2a', 'private') returning id",
      [room!.id, user],
    );
    await sql(
      "insert into shiur_recordings (shiur_id, owner_user_id, storage_key, duration_ms) values ($1, $2, 'recordings/seed-1', 60000), ($1, $3, 'recordings/seed-2', 61000)",
      [shiur!.id, user, other],
    );
    // Social graph and posts (specs 023-026): the user's person profile, an institution they run, a follow, a post, a reply,
    // a reaction and a notification, each pointing at the other user too, so deleting one user must keep the other's rows.
    const [profile] = await sql<{ id: string }>(
      "insert into profiles (kind, user_id, name) values ('person', $1, 'Seed Learner') returning id",
      [user],
    );
    const [inst] = await sql<{ id: string }>(
      "insert into profiles (kind, name) values ('institution', 'Seed Shul') returning id",
    );
    await sql("insert into profile_admins (profile_id, user_id) values ($1, $2)", [inst!.id, user]);
    await sql("insert into follows (follower_user_id, profile_id) values ($1, $2)", [other, profile!.id]);
    const [post] = await sql<{ id: string }>(
      "insert into posts (author_profile_id, created_by_user_id, body, ref) values ($1, $2, 'Seed post', 'Genesis 1:1') returning id",
      [profile!.id, user],
    );
    await sql("insert into replies (post_id, author_profile_id, created_by_user_id, body) values ($1, $2, $3, 'Seed reply')", [
      post!.id,
      profile!.id,
      user,
    ]);
    await sql("insert into reactions (post_id, user_id) values ($1, $2)", [post!.id, other]);
    // spec 030: the user reposts their own post
    await sql("insert into reposts (post_id, profile_id, created_by_user_id) values ($1, $2, $3)", [post!.id, profile!.id, user]);
    await sql("insert into notifications (recipient_user_id, kind, actor_profile_id, post_id) values ($1, 'reaction', $2, $3)", [
      user,
      profile!.id,
      post!.id,
    ]);
    for (const t of [
      "user_display",
      "rooms",
      "room_members",
      "shiurim",
      "shiur_recordings",
      "profiles",
      "profile_admins",
      "follows",
      "posts",
      "replies",
      "reactions",
      "reposts",
      "notifications",
    ])
      written.add(t);
  }
  await sql("insert into deleted_users (user_id, event_id) values ($1, 'seed-event')", [unrelated]);
  await sql("insert into webhook_receipts (event_id, event_type) values ('seed-event', 'user.deleted')");
  written.add("deleted_users").add("webhook_receipts");
  return [...written].sort();
}

export async function publicTables(sql: Sql): Promise<string[]> {
  const rows = await sql<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1",
  );
  return rows.map((r) => r.table_name);
}

export async function uncoveredTables(sql: Sql, seeded: string[]): Promise<string[]> {
  return (await publicTables(sql)).filter((t) => !seeded.includes(t));
}

/** "table.column: n" for every column holding `userId` (as its text value, or inside a JSON value). */
export async function userValues(sql: Sql, userId: number): Promise<string[]> {
  const columns = await sql<{ table_name: string; column_name: string; data_type: string }>(
    `select c.table_name, c.column_name, c.data_type
     from information_schema.columns c
     join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
     order by c.table_name, c.ordinal_position`,
  );
  const found: string[] = [];
  for (const col of columns) {
    const ident = `"${col.table_name.replace(/"/g, '""')}"."${col.column_name.replace(/"/g, '""')}"`;
    const from = `"${col.table_name.replace(/"/g, '""')}"`;
    const isJson = col.data_type === "json" || col.data_type === "jsonb";
    const where = isJson ? `${ident}::text ~ ('(^|[^0-9])' || $1 || '([^0-9]|$)')` : `${ident}::text = $1`;
    const [row] = await sql<{ n: number }>(`select count(*)::int as n from ${from} where ${where}`, [String(userId)]);
    if (row!.n > 0) found.push(`${col.table_name}.${col.column_name}: ${row!.n}`);
  }
  return found;
}
