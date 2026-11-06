/**
 * The protocol's surface (issue #169, D6): one line per command, field (with `?` when optional),
 * constant and enum value of every exported schema of packages/protocol, read from its JSON
 * Schema. A line the release baseline has and the code lost is a breaking change: a removed
 * command or field, an optional field made required, a dropped enum value. Additions are free.
 */
import { byCodeUnit } from "../../packages/protocol/src/compare.ts";

/** A JSON Schema node, as far as the walk reads it. */
interface Node {
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, Node>;
  required?: string[];
  anyOf?: Node[];
  oneOf?: Node[];
  allOf?: Node[];
  items?: Node;
  additionalProperties?: Node | boolean;
}

/** The surface lines of one schema, from its JSON Schema, prefixed by its export name. */
export function walkSchema(name: string, schema: unknown): string[] {
  const out: string[] = [];
  const walk = (node: Node | undefined, path: string) => {
    if (!node || typeof node !== "object") return;
    for (const value of node.enum ?? []) out.push(`${path}=${JSON.stringify(value)}`);
    if (node.const !== undefined) out.push(`${path}==${JSON.stringify(node.const)}`);
    const required = new Set(node.required ?? []);
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      out.push(`${path}.${key}${required.has(key) ? "" : "?"}`);
      walk(child, `${path}.${key}`);
    }
    for (const list of [node.anyOf, node.oneOf, node.allOf]) {
      (list ?? []).forEach((child, i) => {
        // A discriminated union is named by its tag, so reordering its members changes nothing.
        const tag = child?.properties?.type?.const;
        walk(child, tag === undefined ? `${path}|${i}` : `${path}[type=${String(tag)}]`);
      });
    }
    walk(node.items, `${path}[]`);
    if (typeof node.additionalProperties === "object") walk(node.additionalProperties, `${path}{}`);
  };
  walk(schema as Node, name);
  return out;
}

/** The lines of the baseline the current surface no longer has, sorted. */
export function removed(baseline: string[], current: string[]): string[] {
  const now = new Set(current);
  return baseline.filter((line) => !now.has(line)).sort(byCodeUnit);
}
