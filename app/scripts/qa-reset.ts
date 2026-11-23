// `npm run qa:reset`: empty every table of DATABASE_URL's schema (a test database only) and check that each has zero rows.
import { closeDb, getPool } from "../src/server/db/client";
import { resetAll } from "../src/server/db/qa-seed";

try {
  const counts = await resetAll(getPool());
  const left = Object.entries(counts).filter(([, n]) => n > 0);
  if (left.length) {
    console.error(`qa:reset: rows left in ${left.map(([t, n]) => `${t} (${n})`).join(", ")}`);
    process.exitCode = 1;
  } else console.log(`qa:reset: ${Object.keys(counts).length} tables, zero rows each`);
} finally {
  await closeDb();
}
