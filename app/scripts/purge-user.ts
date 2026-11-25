// `npm run purge-user -- <userId>`: staff-only deletion of a user's social data, for a deletion webhook that was lost
// (Django gives up after about 30 minutes of retries; plan section 6.3). Same function and tombstone as the webhook. Needs
// the server's DATABASE_URL; having it is what makes this staff-only.
import { closeDb, getDb } from "../src/server/db/client";
import { log } from "../src/server/log/logger";
import { deleteUserData } from "../src/server/services/users";
import { sweepOrphanObjects } from "../src/server/services/recordings";

const arg = process.argv[2] ?? "";
if (!/^[1-9][0-9]{0,15}$/.test(arg) || !Number.isSafeInteger(Number(arg))) {
  console.error("usage: npm run purge-user -- <Sefaria user id (a positive integer)>");
  process.exit(2);
}
const userId = Number(arg);
try {
  const counts = await getDb().transaction((tx) => deleteUserData(tx, userId, null));
  await sweepOrphanObjects(); // spec 051: the media of the user's recordings, whose rows just went
  log.info("user.purged", { ...counts });
  console.log(`purge-user: removed rows per table: ${JSON.stringify(counts)}; tombstone written.`);
} finally {
  await closeDb();
}
