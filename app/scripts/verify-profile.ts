// `npm run verify-profile -- <profile id or @handle> --by <name> [--off]`: staff mark a person's profile verified (the blue
// check that lets them publish Claude assets to the sidebar; spec 062), or remove the mark. Removing it hides their published
// assets from the sidebar at once. Needs the server's DATABASE_URL; having it is what makes this staff-only.
import { closeDb, getDb } from "../src/server/db/client";
import { setVerified } from "../src/server/services/staff";

const args = process.argv.slice(2);
const off = args.includes("--off");
const byAt = args.indexOf("--by");
const by = byAt >= 0 ? (args[byAt + 1] ?? "").trim() : "";
const target = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--by") ?? "";
if (!target || (!off && !by) || by.length > 200) {
  console.error("usage: npm run verify-profile -- <profile id or @handle> --by <your name> [--off]");
  process.exit(2);
}
try {
  const row = await setVerified(getDb(), target, !off, by);
  if (!row) {
    console.error(`verify-profile: no person's profile "${target}"; nothing changed.`);
    process.exitCode = 1;
  } else console.log(`verify-profile: ${row.name} (${row.id}) is ${row.verified ? "verified" : "no longer verified"}.`);
} finally {
  await closeDb();
}
