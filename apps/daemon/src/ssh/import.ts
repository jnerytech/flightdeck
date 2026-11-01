import { readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import type { SshImportEntry, SshImportResult } from "@flightdeck/protocol";
import type { FlightdeckError } from "../errors.ts";
import type { SshTargets } from "./targets.ts";

/** Why one alias was not imported: the English text, and a key with values for the app. */
type Skip = Omit<SshImportResult["skipped"][number], "alias">;

export interface SshImporterOptions {
  targets: SshTargets;
  /** The file to read: `~/.ssh/config`. It is only ever read. */
  configPath: string;
  /** Where `~` points, and where a relative `Include` starts (`<home>/.ssh`). */
  home: string;
  /** The user ssh would use when the file names none. */
  defaultUser: string;
}

type Directive =
  | { kind: "host"; patterns: string[] }
  | { kind: "match" }
  | { kind: "param"; key: string; value: string };

interface Block {
  /** `null`: a Match block, which is never applied. */
  patterns: string[] | null;
  params: Map<string, string>;
}

const MAX_INCLUDE_DEPTH = 8;
const WILDCARD = /[*?]/;

/** An OpenSSH pattern (`*` and `?`) as a regular expression. */
function patternRegex(pattern: string): RegExp {
  const body = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${body}$`);
}

/** A Host line applies to a name when one of its patterns matches and no `!pattern` does. */
function applies(patterns: string[], alias: string): boolean {
  const matches = (pattern: string) => patternRegex(pattern).test(alias);
  const positive = patterns.filter((p) => !p.startsWith("!"));
  const negative = patterns.filter((p) => p.startsWith("!")).map((p) => p.slice(1));
  return positive.some(matches) && !negative.some(matches);
}

function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

/**
 * The read-only import of `~/.ssh/config` (phase 15): `Host`, `HostName`, `User`, `Port`,
 * `IdentityFile`, `ProxyJump` and `Include`. Values come the way OpenSSH picks them, the first
 * one found in file order, so a `Host *` at the end gives defaults to the names that set nothing.
 */
export class SshImporter {
  constructor(private readonly opts: SshImporterOptions) {}

  preview(): { entries: SshImportEntry[] } {
    const blocks = this.blocks();
    const existing = this.opts.targets.list();
    const aliases = new Set<string>();
    for (const block of blocks) {
      for (const pattern of block.patterns ?? []) {
        if (!WILDCARD.test(pattern) && !pattern.startsWith("!")) aliases.add(pattern);
      }
    }
    const entries = [...aliases].map((alias): SshImportEntry => {
      const params = new Map<string, string>();
      for (const block of blocks) {
        if (!block.patterns || !applies(block.patterns, alias)) continue;
        for (const [key, value] of block.params) if (!params.has(key)) params.set(key, value);
      }
      const host = params.get("hostname") ?? alias;
      const port = Number(params.get("port") ?? 22);
      const user = params.get("user") ?? this.opts.defaultUser;
      const proxyJump = params.get("proxyjump");
      return {
        alias,
        host,
        port,
        user,
        identityFile: params.get("identityfile") ?? null,
        proxyJump: proxyJump && proxyJump.toLowerCase() !== "none" ? proxyJump : null,
        exists: existing.some(
          (t) => t.name === alias || (t.host === host && t.port === port && t.user === user),
        ),
      };
    });
    return { entries };
  }

  /** Creates the chosen destinos, a jump before whoever goes through it. */
  apply(aliases: string[]): SshImportResult {
    const entries = new Map(this.preview().entries.map((entry) => [entry.alias, entry]));
    const chosen = new Set(aliases);
    const created: SshImportResult["created"] = [];
    const ids = new Map<string, string>();
    const failed = new Map<string, Skip>();
    const inProgress = new Set<string>();
    const fail = (alias: string, skip: Skip) => {
      failed.set(alias, skip);
      return skip;
    };
    const make = (alias: string): { id: string } | Skip => {
      const done = ids.get(alias);
      if (done) return { id: done };
      const bad = failed.get(alias);
      if (bad) return bad;
      if (inProgress.has(alias)) return { reason: "ProxyJump cycle", why: "ssh_import_cycle" };
      const entry = entries.get(alias);
      if (!entry) {
        return fail(alias, { reason: "not in ~/.ssh/config", why: "ssh_import_not_in_config" });
      }
      if (entry.exists) return fail(alias, { reason: "already exists", why: "ssh_import_exists" });
      inProgress.add(alias);
      let jump: string | null = null;
      const via = entry.proxyJump;
      if (via?.includes(",")) {
        return fail(alias, {
          reason: `several jumps (ProxyJump ${via}) are not supported`,
          why: "ssh_import_multi_jump",
          params: { jump: via },
        });
      }
      if (via) {
        const registered = this.opts.targets.list().find((t) => t.name === via);
        const made = registered ? { id: registered.id } : chosen.has(via) ? make(via) : null;
        if (!made) {
          return fail(alias, {
            reason: `ProxyJump ${via} is not a destination: import it first`,
            why: "ssh_import_jump_unknown",
            params: { jump: via },
          });
        }
        if ("reason" in made) {
          return fail(alias, {
            reason: `jump "${via}" was not created: ${made.reason}`,
            why: "ssh_import_jump_failed",
            params: { jump: via },
          });
        }
        jump = made.id;
      }
      try {
        const target = this.opts.targets.save({
          name: alias,
          host: entry.host,
          port: entry.port,
          user: entry.user,
          auth: entry.identityFile ? "key-file" : "agent",
          secretRef: entry.identityFile,
          jump,
        });
        ids.set(alias, target.id);
        created.push(target);
        return { id: target.id };
      } catch (error) {
        const refusal = error as Partial<FlightdeckError> & Error;
        return fail(alias, {
          reason: refusal.message,
          ...(refusal.reason ? { why: refusal.reason } : {}),
          ...(refusal.params ? { params: refusal.params } : {}),
        });
      } finally {
        inProgress.delete(alias);
      }
    };
    const skipped: SshImportResult["skipped"] = [];
    for (const alias of chosen) {
      const result = make(alias);
      if ("reason" in result) skipped.push({ alias, ...result });
    }
    return { created, skipped };
  }

  /** The config as blocks in file order; what comes before the first Host applies to all. */
  private blocks(): Block[] {
    const blocks: Block[] = [{ patterns: ["*"], params: new Map() }];
    for (const directive of this.directives(this.opts.configPath, [])) {
      if (directive.kind === "host") {
        blocks.push({ patterns: directive.patterns, params: new Map() });
      } else if (directive.kind === "match") {
        blocks.push({ patterns: null, params: new Map() });
      } else {
        const params = (blocks.at(-1) as Block).params;
        if (!params.has(directive.key)) params.set(directive.key, directive.value);
      }
    }
    return blocks;
  }

  /** The directives of a file, with each `Include` expanded in place. */
  private directives(path: string, stack: string[]): Directive[] {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return [];
    }
    const out: Directive[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line === "" || line.startsWith("#")) continue;
      const match = /^(\S+?)(?:\s*=\s*|\s+)(.*)$/.exec(line);
      if (!match) continue;
      const key = (match[1] as string).toLowerCase();
      const value = unquote((match[2] as string).trim());
      if (key === "host") {
        out.push({ kind: "host", patterns: value.split(/\s+/).map(unquote) });
      } else if (key === "match") {
        out.push({ kind: "match" });
      } else if (key === "include") {
        if (stack.length >= MAX_INCLUDE_DEPTH) continue;
        for (const file of this.included(value)) {
          if (file !== path && !stack.includes(file)) {
            out.push(...this.directives(file, [...stack, path]));
          }
        }
      } else {
        out.push({ kind: "param", key, value });
      }
    }
    return out;
  }

  /** The files an `Include` names: `~` and relative paths resolved, a glob in the last part. */
  private included(value: string): string[] {
    const files: string[] = [];
    for (const word of value.split(/\s+/)) {
      const expanded = word.startsWith("~/") ? join(this.opts.home, word.slice(2)) : word;
      const absolute = isAbsolute(expanded) ? expanded : join(this.opts.home, ".ssh", expanded);
      if (!WILDCARD.test(basename(absolute))) {
        files.push(absolute);
        continue;
      }
      const glob = new Bun.Glob(basename(absolute));
      const names = [...glob.scanSync({ cwd: dirname(absolute), onlyFiles: true })].sort();
      files.push(...names.map((name) => join(dirname(absolute), name)));
    }
    return files;
  }
}
