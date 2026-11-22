// The migration check's own tests: each rule fires on its fault, the contract note lifts it, and the committed migrations pass.
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { checkMigrationSql, checkMigrationsDir } from "./migration-rules";

const rulesOf = (sql: string) => checkMigrationSql("0009_x.sql", sql).map((v) => v.rule);

describe("migration rules", () => {
  it.each([
    ['DROP TABLE "rooms";', "drop-table"],
    ['ALTER TABLE "rooms" DROP COLUMN "title";', "drop-column"],
    ['ALTER TABLE "rooms" RENAME COLUMN "title" TO "name";', "rename"],
    ['ALTER TABLE "rooms" ALTER COLUMN "title" SET DATA TYPE varchar(10);', "retype"],
    ['ALTER TABLE "rooms" ALTER COLUMN "title" TYPE varchar(10);', "retype"],
    ['ALTER TABLE "rooms" ALTER COLUMN "title" SET NOT NULL;', "set-not-null"],
    ['ALTER TABLE "rooms" ADD COLUMN "slug" text NOT NULL;', "add-required-column"],
  ])("refuses %s", (sql, rule) => {
    expect(rulesOf(sql)).toEqual([rule]);
  });

  it.each([
    'CREATE TABLE "x" ("id" uuid PRIMARY KEY NOT NULL);',
    'ALTER TABLE "rooms" ADD COLUMN "slug" text;',
    'ALTER TABLE "rooms" ADD COLUMN "slug" text DEFAULT \'\' NOT NULL;',
    'ALTER TABLE "rooms" DROP CONSTRAINT "rooms_x_fk";',
    'CREATE INDEX "i" ON "rooms" USING btree ("title");',
  ])("allows the expand step %s", (sql) => {
    expect(rulesOf(sql)).toEqual([]);
  });

  it("names the file and the statement", () => {
    const [v] = checkMigrationSql("0009_x.sql", 'ALTER TABLE "rooms" DROP COLUMN "title";');
    expect(v?.message).toContain('0009_x.sql: "ALTER TABLE "rooms" DROP COLUMN "title"" drops a column');
  });

  it("allows a contract step that says why", () => {
    const sql = '-- contract: title unused since the previous release\nALTER TABLE "rooms" DROP COLUMN "title";';
    expect(rulesOf(sql)).toEqual([]);
  });

  it("does not accept an empty contract note", () => {
    expect(rulesOf('-- contract:\nALTER TABLE "rooms" DROP COLUMN "title";')).toEqual(["drop-column"]);
  });

  it("passes on the committed migrations", () => {
    expect(checkMigrationsDir(fileURLToPath(new URL("./migrations", import.meta.url)))).toEqual([]);
  });
});
