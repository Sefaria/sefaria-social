// Temporary repo trees for the negative tests: each test writes the files it needs under a fresh temp directory, so the
// violating fixtures never sit inside the real scan.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach } from "vitest";

const made: string[] = [];
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

export function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "social-arch-"));
  made.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}
