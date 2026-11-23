// Expand, deploy, contract (plan section 6.2): a migration must not break the server version still running during a
// rolling deploy. Statements that would (drop, rename, retype, a new NOT NULL) are refused unless the file carries a
// `-- contract: <reason>` line, which a human reviewer reads (migrations are a protected path).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface MigrationViolation {
  file: string;
  statement: string;
  rule: string;
  message: string;
}

const RULES: { rule: string; test: RegExp; why: string }[] = [
  { rule: "drop-table", test: /\bdrop\s+table\b/i, why: "drops a table the running server may still read" },
  {
    rule: "drop-column",
    test: /\balter\s+table\b[\s\S]*\bdrop\s+(column\s+)?(?!constraint\b|default\b)"?\w/i,
    why: "drops a column",
  },
  { rule: "rename", test: /\balter\s+table\b[\s\S]*\brename\b/i, why: "renames a table or column" },
  { rule: "retype", test: /\balter\s+column\b[\s\S]*\b(set\s+data\s+)?type\b/i, why: "changes a column's type" },
  { rule: "set-not-null", test: /\balter\s+column\b[\s\S]*\bset\s+not\s+null\b/i, why: "makes an existing column NOT NULL" },
  {
    rule: "add-required-column",
    test: /\badd\s+column\b(?![\s\S]*\bdefault\b)[\s\S]*\bnot\s+null\b/i,
    why: "adds a NOT NULL column without a default, which the running server does not write",
  },
];

const CONTRACT_NOTE = /^[ \t]*--[ \t]*contract:[ \t]*\S/im;

/** Split drizzle-kit SQL into statements. */
function statements(sql: string): string[] {
  return sql
    .split(/-->\s*statement-breakpoint|;\s*$/m)
    .flatMap((s) => s.split(/;\s*\n/))
    .map((s) =>
      s
        .split("\n")
        .filter((l) => !/^\s*--/.test(l))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}

export function checkMigrationSql(file: string, sql: string): MigrationViolation[] {
  if (CONTRACT_NOTE.test(sql)) return [];
  const out: MigrationViolation[] = [];
  for (const statement of statements(sql)) {
    for (const r of RULES) {
      if (!r.test.test(statement)) continue;
      const short = statement.replace(/\s+/g, " ").slice(0, 160);
      out.push({
        file,
        statement: short,
        rule: r.rule,
        message: `${file}: "${short}" ${r.why}. Fix: split it into expand (add, backfill) now and contract (remove) in a later release; when this file is the contract step, add a line "-- contract: <why it is safe now>".`,
      });
      break;
    }
  }
  return out;
}

export function checkMigrationsDir(dir: string): MigrationViolation[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => checkMigrationSql(path.join(path.basename(dir), f), readFileSync(path.join(dir, f), "utf8")));
}
