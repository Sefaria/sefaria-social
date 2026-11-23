// The OpenAPI breaking-change check (plan section 6.2; decision 0004). Compares the base and head documents and lists the
// changes an older client could trip over. Deliberately small; the rules it knows are listed in RULES.
type Json = Record<string, unknown>;

export const RULES = [
  "operation-removed",
  "param-added-required",
  "request-required-added",
  "response-property-removed",
  "response-property-optional",
  "response-enum-widened",
  "type-changed",
] as const;
export type Rule = (typeof RULES)[number];

export interface BreakingChange {
  rule: Rule;
  where: string;
  message: string;
}

const METHODS = ["get", "put", "post", "delete", "patch", "options", "head"];
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const types = (s: Json): string[] => {
  const t = s.type;
  if (Array.isArray(t)) return [...t].map(String).sort();
  if (typeof t === "string") return [t];
  if (Array.isArray(s.anyOf)) return [...new Set(s.anyOf.flatMap((x) => types(obj(x))))].sort();
  return [];
};
const required = (s: Json) => new Set(Array.isArray(s.required) ? s.required.map(String) : []);
const jsonSchemaOf = (content: unknown) => obj(obj(obj(content)["application/json"]).schema);

/** mode "request": what clients send (head must accept everything base accepted). "response": what clients read. */
function compareSchemas(base: Json, head: Json, where: string, mode: "request" | "response", out: BreakingChange[]) {
  const bt = types(base);
  const ht = types(head);
  if (bt.length && ht.length) {
    const lost = mode === "request" ? bt.filter((t) => !ht.includes(t)) : ht.filter((t) => !bt.includes(t));
    if (lost.length) {
      out.push({
        rule: "type-changed",
        where,
        message: `${where}: type changed from ${bt.join("|")} to ${ht.join("|")}`,
      });
      return;
    }
  }
  if (mode === "response" && Array.isArray(base.enum) && Array.isArray(head.enum)) {
    const added = head.enum.filter((v) => !(base.enum as unknown[]).includes(v));
    if (added.length)
      out.push({
        rule: "response-enum-widened",
        where,
        message: `${where}: new value(s) ${JSON.stringify(added)} that existing clients do not handle`,
      });
  }
  const bp = obj(base.properties);
  const hp = obj(head.properties);
  const br = required(base);
  const hr = required(head);
  if (mode === "response") {
    for (const name of Object.keys(bp)) {
      if (!(name in hp)) {
        out.push({ rule: "response-property-removed", where: `${where}.${name}`, message: `${where}.${name}: property removed` });
        continue;
      }
      if (br.has(name) && !hr.has(name))
        out.push({
          rule: "response-property-optional",
          where: `${where}.${name}`,
          message: `${where}.${name}: was required, now optional`,
        });
    }
  } else {
    for (const name of hr)
      if (!br.has(name))
        out.push({
          rule: "request-required-added",
          where: `${where}.${name}`,
          message: `${where}.${name}: new required property`,
        });
  }
  for (const name of Object.keys(bp)) if (name in hp) compareSchemas(obj(bp[name]), obj(hp[name]), `${where}.${name}`, mode, out);
  if (base.items && head.items) compareSchemas(obj(base.items), obj(head.items), `${where}[]`, mode, out);
}

export function breakingChanges(base: Json, head: Json): BreakingChange[] {
  const out: BreakingChange[] = [];
  const basePaths = obj(base.paths);
  const headPaths = obj(head.paths);
  for (const [path, item] of Object.entries(basePaths)) {
    for (const method of METHODS) {
      const bop = obj(obj(item)[method]);
      if (!Object.keys(bop).length) continue;
      const op = `${method.toUpperCase()} ${path}`;
      const hop = obj(obj(headPaths[path])[method]);
      if (!Object.keys(hop).length) {
        out.push({ rule: "operation-removed", where: op, message: `${op}: operation removed` });
        continue;
      }
      const bParams = (Array.isArray(bop.parameters) ? bop.parameters : []).map(obj);
      const hParams = (Array.isArray(hop.parameters) ? hop.parameters : []).map(obj);
      for (const hpar of hParams) {
        const bpar = bParams.find((p) => p.name === hpar.name && p.in === hpar.in);
        const where = `${op} ${String(hpar.in)} parameter ${String(hpar.name)}`;
        if (!bpar && hpar.required === true)
          out.push({ rule: "param-added-required", where, message: `${where}: new required parameter` });
        else if (bpar) compareSchemas(obj(bpar.schema), obj(hpar.schema), where, "request", out);
      }
      const bBody = jsonSchemaOf(obj(bop.requestBody).content);
      const hBody = jsonSchemaOf(obj(hop.requestBody).content);
      if (Object.keys(hBody).length && !Object.keys(bBody).length && obj(hop.requestBody).required === true)
        out.push({ rule: "request-required-added", where: `${op} body`, message: `${op} body: a required body was added` });
      else if (Object.keys(bBody).length) compareSchemas(bBody, hBody, `${op} body`, "request", out);
      for (const [status, bres] of Object.entries(obj(bop.responses))) {
        const hres = obj(obj(hop.responses)[status]);
        const bs = jsonSchemaOf(obj(bres).content);
        const hs = jsonSchemaOf(hres.content);
        if (Object.keys(bs).length && Object.keys(hres).length)
          compareSchemas(bs, hs, `${op} ${status} response`, "response", out);
      }
    }
  }
  return out;
}

export interface Verdict {
  ok: boolean;
  lines: string[];
}

/** The CI decision: breaking changes fail unless a spec changed in the PR declares `contract_impact: api-major`. */
export function verdict(changes: BreakingChange[], changedSpecs: { id: string; contractImpact: string | null }[]): Verdict {
  if (changes.length === 0) return { ok: true, lines: ["api-breaking: PASS (no breaking changes)"] };
  const major = changedSpecs.filter((s) => s.contractImpact === "api-major").map((s) => s.id);
  const list = changes.map((c) => `  x [${c.rule}] ${c.message}`);
  if (major.length)
    return {
      ok: true,
      lines: [
        `api-breaking: PASS with notice: ${changes.length} breaking change(s), declared by spec(s) ${major.join(", ")} (contract_impact: api-major)`,
        ...list,
      ],
    };
  return {
    ok: false,
    lines: [
      `api-breaking: FAIL (${changes.length} breaking change(s) against the base's packages/api-client/openapi.json)`,
      ...list,
      "  fix: keep the old shape (add, don't remove or retype; new request fields optional), or shape a spec with contract_impact: api-major that a human agrees to, so older surfaces are planned for.",
    ],
  };
}
