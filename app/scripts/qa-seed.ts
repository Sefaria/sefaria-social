// `npm run qa:seed -- <scenario>` or `-- --all`: seed e2e/qa/seeds/<scenario>.json into DATABASE_URL (a test database).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getDb } from "../src/server/db/client";
import { seedScenario } from "../src/server/db/qa-seed";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../e2e/qa/seeds");
const arg = process.argv[2];
const all = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));
const scenarios = arg === "--all" ? all : arg && all.includes(arg) ? [arg] : null;
if (!scenarios) {
  console.error(`usage: npm run qa:seed -- <${all.join("|")}> | --all`);
  process.exit(2);
}
if (!/test/i.test(new URL(process.env.DATABASE_URL ?? "postgres://x/none").pathname)) {
  console.error('qa:seed only seeds a database whose name contains "test" (set DATABASE_URL).');
  process.exit(2);
}
try {
  for (const s of scenarios) {
    await seedScenario(getDb(), JSON.parse(readFileSync(path.join(dir, `${s}.json`), "utf8")));
    console.log(`qa:seed: ${s}`);
  }
} finally {
  await closeDb();
}
