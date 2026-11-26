// `npm run asset-takedown -- <asset id> [--restore]`: staff hide a Claude asset (spec 062): it leaves the sidebar, its reads
// and its content at once; its owner sees it marked hidden. `--restore` shows it again. Needs the server's DATABASE_URL.
import { closeDb, getDb } from "../src/server/db/client";
import { setHidden } from "../src/server/services/staff";

const args = process.argv.slice(2);
const restore = args.includes("--restore");
const target = args.find((a) => !a.startsWith("--")) ?? "";
if (!target) {
  console.error("usage: npm run asset-takedown -- <asset id> [--restore]");
  process.exit(2);
}
try {
  const row = await setHidden(getDb(), target, !restore);
  if (!row) {
    console.error(`asset-takedown: no asset "${target}"; nothing changed.`);
    process.exitCode = 1;
  } else console.log(`asset-takedown: "${row.title}" (${row.id}) is ${row.hidden ? "hidden" : "shown again"}.`);
} finally {
  await closeDb();
}
