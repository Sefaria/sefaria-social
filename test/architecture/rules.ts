// Architecture rules for app/src (plan sections 3, 4.1 and routing rule R1). Each check takes the directory to scan, so the
// negative tests can point it at a temporary tree that breaks the rule. Every violation message ends with a "Fix:" line that
// tells the reader (often an agent) how to repair it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface Violation {
  rule: "layers" | "client-server-ban" | "server-no-react" | "history";
  file: string; // relative to the scanned repo root, with forward slashes
  line: number;
  message: string;
}

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".output", ".tanstack"]);

export const LAYERS = ["lib", "server", "ui", "features", "routes", "surface"] as const;
export type Layer = (typeof LAYERS)[number];
/** Plan section 3: lib → (server | ui) → features → routes | surface. Same rank and different layer: siblings, no imports. */
const RANK: Record<Layer, number> = { lib: 0, server: 1, ui: 1, features: 2, routes: 3, surface: 3 };
/** Layers that end up in the browser (the surface bundle or client pages): never server code or the Start runtime. */
const CLIENT_LAYERS: readonly Layer[] = ["surface", "features", "ui", "lib"];
const REACT_PACKAGES = /^(?:react|react-dom|@tanstack\/react-router|@tanstack\/react-query)(?:\/.*)?$/;
const START_PACKAGE = /^@tanstack\/react-start(?:\/.*)?$/;
/** R1: the only file allowed to call the browser history and location APIs. */
export const HOST_HISTORY_FILE = "app/src/surface/host-history.ts";

const toPosix = (p: string) => p.split(path.sep).join("/");

export function listSourceFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return []; // a folder that does not exist has no files to check
  }
  return entries.flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return SKIP_DIRS.has(name) ? [] : listSourceFiles(full);
    return SOURCE_EXT.test(name) ? [full] : [];
  });
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}

const lineOf = (sf: ts.SourceFile, node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

export interface ImportRef {
  specifier: string;
  line: number;
}

/** Static imports, re-exports, `import()` and `require()` with a string literal. Type-only imports count too. */
export function importsOf(file: string): ImportRef[] {
  const sf = parse(file);
  const found: ImportRef[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) found.push({ specifier: node.moduleSpecifier.text, line: lineOf(sf, node) });
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const [arg] = node.arguments;
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if ((isDynamicImport || isRequire) && arg && ts.isStringLiteralLike(arg))
        found.push({ specifier: arg.text, line: lineOf(sf, node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Absolute path an import points at, or null for a package import. Understands relative paths and the `~/` alias (app/src). */
function resolveSpecifier(fromFile: string, specifier: string, appSrc: string): string | null {
  if (specifier.startsWith("~/")) return path.join(appSrc, specifier.slice(2));
  if (specifier.startsWith(".")) return path.resolve(path.dirname(fromFile), specifier);
  return null;
}

/** The layer of a path inside app/src: a layer name, "entry" for files directly in app/src, "unknown" for other folders. */
export function layerOf(appSrc: string, abs: string): Layer | "entry" | "unknown" | null {
  const rel = path.relative(appSrc, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (parts.length === 1) return "entry";
  const top = parts[0] as Layer;
  return LAYERS.includes(top) ? top : "unknown";
}

interface Scan {
  repoRoot: string;
  appSrc: string;
}
const scanOf = (repoRoot: string): Scan => ({ repoRoot, appSrc: path.join(repoRoot, "app", "src") });

/** (a) Layer order. */
export function checkLayers(repoRoot: string): Violation[] {
  const { appSrc } = scanOf(repoRoot);
  const out: Violation[] = [];
  for (const file of listSourceFiles(appSrc)) {
    const rel = toPosix(path.relative(repoRoot, file));
    const from = layerOf(appSrc, file);
    if (from === "unknown") {
      out.push({
        rule: "layers",
        file: rel,
        line: 1,
        message: `${rel}:1 is in a folder that is not a layer. Fix: move it under one of app/src/{${LAYERS.join(",")}} (plan section 3), or put an entry file directly in app/src.`,
      });
      continue;
    }
    if (from === "entry" || from === null) continue; // entry files (router, generated route tree) may import any layer
    for (const imp of importsOf(file)) {
      const target = resolveSpecifier(file, imp.specifier, appSrc);
      if (!target) continue;
      const to = layerOf(appSrc, target);
      if (to === null || to === "unknown" || to === from) continue;
      if (to === "entry") {
        out.push({
          rule: "layers",
          file: rel,
          line: imp.line,
          message: `${rel}:${imp.line} (${from}) imports "${imp.specifier}", an entry file of app/src. Fix: entry files sit above every layer; move what you need into lib/ (or the layer that owns it) and import it from there.`,
        });
      } else if (RANK[to] >= RANK[from]) {
        out.push({
          rule: "layers",
          file: rel,
          line: imp.line,
          message: `${rel}:${imp.line} (${from}) imports "${imp.specifier}" (${to}). The layer order is lib → (server | ui) → features → routes | surface; a layer imports only layers to its left. Fix: move the shared code down into a layer both may import (usually lib/ for pure code, ui/ for presentational components), or invert the dependency by passing it in from the higher layer.`,
        });
      }
    }
  }
  return out;
}

/** (b) Client layers never import server code or the Start runtime. */
export function checkClientServerBan(repoRoot: string): Violation[] {
  const { appSrc } = scanOf(repoRoot);
  const out: Violation[] = [];
  for (const file of listSourceFiles(appSrc)) {
    const from = layerOf(appSrc, file);
    if (!from || !CLIENT_LAYERS.includes(from as Layer)) continue;
    const rel = toPosix(path.relative(repoRoot, file));
    for (const imp of importsOf(file)) {
      const target = resolveSpecifier(file, imp.specifier, appSrc);
      if (target ? layerOf(appSrc, target) === "server" : false) {
        out.push({
          rule: "client-server-ban",
          file: rel,
          line: imp.line,
          message: `${rel}:${imp.line} (${from}) imports server code "${imp.specifier}". Code under app/src/{${CLIENT_LAYERS.join(",")}} runs in the browser (the surface bundle) and must never import app/src/server. Fix: reach the server over HTTPS through packages/api-client; move shared pure code (schemas, ids) into app/src/lib.`,
        });
      } else if (START_PACKAGE.test(imp.specifier)) {
        out.push({
          rule: "client-server-ban",
          file: rel,
          line: imp.line,
          message: `${rel}:${imp.line} (${from}) imports "${imp.specifier}". The surface bundle is client only: no @tanstack/react-start (createServerFn, server functions, server APIs) under app/src/{${CLIENT_LAYERS.join(",")}} (plan section 4.1). Fix: put server functions in app/src/server and call them from routes/, or call the API through packages/api-client.`,
        });
      }
    }
  }
  return out;
}

/** (c) server/ never imports React (or React bindings), and holds no JSX files. */
export function checkServerNoReact(repoRoot: string): Violation[] {
  const { appSrc } = scanOf(repoRoot);
  const out: Violation[] = [];
  for (const file of listSourceFiles(path.join(appSrc, "server"))) {
    const rel = toPosix(path.relative(repoRoot, file));
    if (/\.[jt]sx$/.test(file)) {
      out.push({
        rule: "server-no-react",
        file: rel,
        line: 1,
        message: `${rel}:1 is a JSX file in app/src/server. Server code never renders React. Fix: rename it to .ts if it has no JSX, or move the component to app/src/ui or app/src/features.`,
      });
    }
    for (const imp of importsOf(file)) {
      if (REACT_PACKAGES.test(imp.specifier)) {
        out.push({
          rule: "server-no-react",
          file: rel,
          line: imp.line,
          message: `${rel}:${imp.line} imports "${imp.specifier}". app/src/server never imports React or its bindings (plan section 3). Fix: return plain data from the server and render it in app/src/routes, features or ui.`,
        });
      }
    }
  }
  return out;
}

/** Roots scanned for R1: social's own code. The harness and packages/host-contract play the reader (the host) and own history. */
export const HISTORY_ROOTS = ["app/src", "packages/session", "packages/api-client", "packages/relay"];

const endsWithLocation = (e: ts.Expression) =>
  (ts.isIdentifier(e) && e.text === "location") || (ts.isPropertyAccessExpression(e) && e.name.text === "location");

/** (d) R1: no history.pushState/replaceState, location.assign/replace, or writes to location / location.href. */
export function checkHistory(repoRoot: string, roots: readonly string[] = HISTORY_ROOTS): Violation[] {
  const out: Violation[] = [];
  for (const root of roots) {
    for (const file of listSourceFiles(path.join(repoRoot, root))) {
      const rel = toPosix(path.relative(repoRoot, file));
      if (rel === HOST_HISTORY_FILE) continue;
      const sf = parse(file);
      const report = (node: ts.Node, what: string) => {
        const line = lineOf(sf, node);
        out.push({
          rule: "history",
          file: rel,
          line,
          message: `${rel}:${line} ${what}. Routing rule R1: the reader's router is the only owner of the address bar and window.history. Fix: navigate with host.navigate(to, { replace }) or through the surface router (its history is ${HOST_HISTORY_FILE}); build links with host.href(). See docs/ROUTING.md.`,
        });
      };
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const name = node.expression.name.text;
          if (name === "pushState" || name === "replaceState") report(node, `calls ${name}()`);
          else if ((name === "assign" || name === "replace") && endsWithLocation(node.expression.expression))
            report(node, `calls location.${name}()`);
        } else if (
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        ) {
          const left = node.left;
          if (ts.isPropertyAccessExpression(left) && left.name.text === "href" && endsWithLocation(left.expression))
            report(node, "assigns location.href");
          else if (endsWithLocation(left)) report(node, "assigns location");
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }
  return out;
}
