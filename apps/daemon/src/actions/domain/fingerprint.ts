export interface Fingerprint {
  /** sha256 of what the action declares (not its name nor its description). */
  declaration: string;
  /** Path (relative to the project, with `/`) → sha256 of the file's content. */
  files: Record<string, string>;
}

/** JSON with the keys sorted, so the same declaration always gives the same text. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    const pairs = entries.map(([k, v]) => JSON.stringify(k) + ":" + canonical(v));
    return "{" + pairs.join(",") + "}";
  }
  return JSON.stringify(value);
}

/** What differs between what was trusted and what is there now: "declaração" and/or file paths. */
export function changes(trusted: Fingerprint, current: Fingerprint): string[] {
  const out: string[] = [];
  if (trusted.declaration !== current.declaration) out.push("declaração");
  for (const path of new Set([...Object.keys(trusted.files), ...Object.keys(current.files)])) {
    if (trusted.files[path] !== current.files[path]) out.push(path);
  }
  return out;
}
