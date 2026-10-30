import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Snippet,
  type SnippetFileInfo,
  SnippetInput,
  type SnippetVar,
} from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import { resolveAllowedCwd } from "../paths.ts";
import { ulid } from "../ulid.ts";
import { fieldsOf, normalizeSnippet, type SecretScanner, type SnippetDef } from "./model.ts";

export interface SnippetsOptions {
  db: Database;
  allowedRoots: readonly string[];
  scanner: SecretScanner;
  now?: () => number;
}

/** What `snippets.save` takes: the snippet, where it goes and, when editing, its id. */
export type SnippetSave = SnippetInput & {
  id?: string;
  scope: "host" | "project";
  /** Project snippets only: the daemon (just yours) or the versioned `.flightdeck/snippets.yaml`. */
  target?: "daemon" | "file";
  projectPath?: string;
};

export interface SnippetFilter {
  scope?: "host" | "project" | "all";
  projectPath?: string;
  query?: string;
  tag?: string;
  type?: "command" | "prompt";
}

interface Row {
  id: string;
  scope: "host" | "project";
  project_path: string | null;
  name: string;
  type: "command" | "prompt";
  body: string;
  vars: string;
  tags: string;
}

interface Mark {
  id: string;
  favorite: number;
  uses: number;
  last_used_at: string | null;
}

interface LoadedFile {
  info: SnippetFileInfo;
  defs: SnippetDef[];
}

const FILE_PREFIX = "file:";
const badRequest = (message: string) => new FlightdeckError("bad_request", message);
const notFound = () => new FlightdeckError("not_found", "snippet não encontrado");

/** The id of a snippet of the versioned file: it has no row of its own. */
const fileId = (projectPath: string, name: string) => `${FILE_PREFIX}${projectPath}:${name}`;

function parseFileId(id: string): { projectPath: string; name: string } | null {
  if (!id.startsWith(FILE_PREFIX)) return null;
  const rest = id.slice(FILE_PREFIX.length);
  const at = rest.lastIndexOf(":");
  return at < 1 ? null : { projectPath: rest.slice(0, at), name: rest.slice(at + 1) };
}

const quoted = (text: string) => JSON.stringify(text);

/** Block YAML for the file, with JSON strings (which are YAML's double-quoted ones). */
function toYaml(defs: SnippetDef[]): string {
  if (defs.length === 0) return "[]\n";
  const lines: string[] = [];
  for (const def of defs) {
    lines.push(`- name: ${quoted(def.name)}`, `  type: ${def.type}`);
    lines.push(
      def.type === "command"
        ? `  run: ${quoted(def.run as string)}`
        : `  text: ${quoted(def.text as string)}`,
    );
    const vars = Object.entries(def.vars);
    if (vars.length > 0) {
      lines.push("  vars:");
      for (const [key, spec] of vars) lines.push(`    ${key}: ${flowVar(spec)}`);
    }
    if (def.tags.length > 0) lines.push(`  tags: [${def.tags.map(quoted).join(", ")}]`);
  }
  return `${lines.join("\n")}\n`;
}

function flowVar(spec: SnippetVar): string {
  const parts: string[] = [];
  if (spec.default !== undefined) parts.push(`default: ${quoted(spec.default)}`);
  if (spec.options && spec.options.length > 0) {
    parts.push(`options: [${spec.options.map(quoted).join(", ")}]`);
  }
  return parts.length === 0 ? "{}" : `{ ${parts.join(", ")} }`;
}

/**
 * The snippets of this host (phase 18): the host's own, the project ones kept in the daemon, and
 * the ones in the project's versioned `.flightdeck/snippets.yaml`. A command from that file runs
 * only when its content is trusted by hash, like a workflow; pasting it never needs trust.
 */
export class Snippets {
  private readonly now: () => number;

  constructor(private readonly opts: SnippetsOptions) {
    this.now = opts.now ?? Date.now;
  }

  list(filter: SnippetFilter): { snippets: Snippet[]; file: SnippetFileInfo | null } {
    const scope = filter.scope ?? "all";
    const project = filter.projectPath ? this.project(filter.projectPath) : null;
    if (scope === "project" && !project) throw badRequest("o escopo project pede projectPath");
    const views: Snippet[] = [];
    if (scope !== "project") views.push(...this.rows("host", null).map((row) => this.fromRow(row)));
    let file: SnippetFileInfo | null = null;
    if (scope !== "host" && project) {
      views.push(...this.rows("project", project).map((row) => this.fromRow(row)));
      const loaded = this.loadFile(project);
      file = loaded?.info ?? null;
      views.push(
        ...(loaded?.defs ?? []).map((def) => this.fromFile(project, def, loaded as LoadedFile)),
      );
    }
    const query = (filter.query ?? "").toLowerCase();
    const matches = (view: Snippet) =>
      (filter.type === undefined || view.type === filter.type) &&
      (filter.tag === undefined || view.tags.includes(filter.tag)) &&
      (query === "" ||
        [view.name, view.run ?? "", view.text ?? "", ...view.tags].some((field) =>
          field.toLowerCase().includes(query),
        ));
    const sorted = views
      .filter(matches)
      .sort(
        (a, b) =>
          Number(b.favorite) - Number(a.favorite) ||
          (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "") ||
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
    return { snippets: sorted, file };
  }

  get(id: string): Snippet {
    const found = this.lookup(id);
    if (!found) throw notFound();
    return found;
  }

  /** By name: the host's, then the project's. */
  find(name: string, projectPath?: string): Snippet {
    const { snippets } = this.list(projectPath ? { projectPath } : {});
    const found = snippets.find((s) => s.name === name);
    if (!found) throw notFound();
    return found;
  }

  save(input: SnippetSave): Snippet {
    const { id, scope, target, projectPath, ...fields } = input;
    const def = normalizeSnippet(fields, this.opts.scanner);
    const project = scope === "project" ? this.requireProject(projectPath) : null;
    const previous = id ? this.lookup(id) : null;
    if (id && !previous) throw notFound();
    if (previous && (previous.scope !== scope || previous.projectPath !== project)) {
      throw badRequest("para mudar de escopo, crie outro snippet");
    }
    const toFile = scope === "project" && target === "file";
    if (previous && (previous.source === "file") !== toFile) {
      throw badRequest("para mudar de lugar, crie outro snippet");
    }
    if (this.nameTaken(scope, project, def.name, previous?.id ?? null)) {
      throw new FlightdeckError("invalid_state", `já existe um snippet "${def.name}" neste escopo`);
    }
    return toFile
      ? this.saveToFile(project as string, def, previous)
      : this.saveRow(scope, project, def, previous);
  }

  remove(id: string): void {
    const found = this.get(id);
    if (found.source === "daemon") {
      this.opts.db.query("DELETE FROM snippets WHERE id = ?").run(id);
    } else {
      const project = found.projectPath as string;
      const defs = (this.loadFile(project)?.defs ?? []).filter((def) => def.name !== found.name);
      this.writeFile(project, toYaml(defs));
    }
    this.opts.db.query("DELETE FROM snippet_marks WHERE id = ?").run(id);
  }

  /** Trusts the content of the project's versioned file, by the hash the app was shown. */
  trust(projectPath: string, hash: string): SnippetFileInfo {
    const project = this.project(projectPath);
    const loaded = this.loadFile(project);
    if (!loaded)
      throw new FlightdeckError("invalid_state", "o projeto não tem .flightdeck/snippets.yaml");
    if (loaded.info.hash !== hash) {
      throw new FlightdeckError(
        "invalid_state",
        "o arquivo mudou desde que foi mostrado: confira de novo",
      );
    }
    this.opts.db
      .query(
        "INSERT OR IGNORE INTO snippet_trust (project_path, hash, trusted_at) VALUES (?, ?, ?)",
      )
      .run(project, hash, new Date(this.now()).toISOString());
    return { ...loaded.info, trusted: true };
  }

  favorite(id: string, favorite: boolean): Snippet {
    this.get(id);
    this.opts.db
      .query(
        `INSERT INTO snippet_marks (id, favorite, uses, last_used_at) VALUES (?, ?, 0, NULL)
         ON CONFLICT (id) DO UPDATE SET favorite = excluded.favorite`,
      )
      .run(id, favorite ? 1 : 0);
    return this.get(id);
  }

  /** A use of the snippet: counts toward "recent". */
  markUsed(id: string): void {
    this.get(id);
    this.opts.db
      .query(
        `INSERT INTO snippet_marks (id, favorite, uses, last_used_at) VALUES (?, 0, 1, ?)
         ON CONFLICT (id) DO UPDATE SET uses = uses + 1, last_used_at = excluded.last_used_at`,
      )
      .run(id, new Date(this.now()).toISOString());
  }

  // -- storage -------------------------------------------------------------------------------

  private project(path: string): string {
    return resolveAllowedCwd(path, this.opts.allowedRoots);
  }

  private requireProject(path: string | undefined): string {
    if (!path) throw badRequest("um snippet de projeto pede projectPath");
    return this.project(path);
  }

  private rows(scope: "host" | "project", project: string | null): Row[] {
    return this.opts.db
      .query("SELECT * FROM snippets WHERE scope = ? AND project_path IS ?")
      .all(scope, project) as Row[];
  }

  private mark(id: string): Mark | null {
    return this.opts.db.query("SELECT * FROM snippet_marks WHERE id = ?").get(id) as Mark | null;
  }

  private view(
    base: {
      id: string;
      scope: "host" | "project";
      source: "daemon" | "file";
      projectPath: string | null;
      runnable: boolean;
    },
    def: SnippetDef,
  ): Snippet {
    const mark = this.mark(base.id);
    return {
      ...base,
      name: def.name,
      type: def.type,
      run: def.run,
      text: def.text,
      vars: def.vars,
      tags: def.tags,
      fields: fieldsOf(def),
      favorite: mark?.favorite === 1,
      uses: mark?.uses ?? 0,
      lastUsedAt: mark?.last_used_at ?? null,
    };
  }

  private fromRow(row: Row): Snippet {
    const def: SnippetDef = {
      name: row.name,
      type: row.type,
      run: row.type === "command" ? row.body : null,
      text: row.type === "prompt" ? row.body : null,
      vars: JSON.parse(row.vars) as Record<string, SnippetVar>,
      tags: JSON.parse(row.tags) as string[],
    };
    return this.view(
      {
        id: row.id,
        scope: row.scope,
        source: "daemon",
        projectPath: row.project_path,
        runnable: true,
      },
      def,
    );
  }

  private fromFile(project: string, def: SnippetDef, loaded: LoadedFile): Snippet {
    return this.view(
      {
        id: fileId(project, def.name),
        scope: "project",
        source: "file",
        projectPath: project,
        runnable: def.type === "prompt" || loaded.info.trusted,
      },
      def,
    );
  }

  private lookup(id: string): Snippet | null {
    const parsed = parseFileId(id);
    if (parsed) {
      const project = this.project(parsed.projectPath);
      const loaded = this.loadFile(project);
      const def = loaded?.defs.find((d) => d.name === parsed.name);
      return def ? this.fromFile(project, def, loaded as LoadedFile) : null;
    }
    const row = this.opts.db.query("SELECT * FROM snippets WHERE id = ?").get(id) as Row | null;
    return row ? this.fromRow(row) : null;
  }

  private nameTaken(
    scope: "host" | "project",
    project: string | null,
    name: string,
    own: string | null,
  ): boolean {
    const inRows = this.rows(scope, project).some((row) => row.name === name && row.id !== own);
    const inFile = project
      ? (this.loadFile(project)?.defs ?? []).some(
          (def) => def.name === name && fileId(project, def.name) !== own,
        )
      : false;
    return inRows || inFile;
  }

  private saveRow(
    scope: "host" | "project",
    project: string | null,
    def: SnippetDef,
    previous: Snippet | null,
  ): Snippet {
    const at = new Date(this.now()).toISOString();
    const id = previous?.id ?? ulid(this.now());
    this.opts.db
      .query(
        `INSERT INTO snippets (id, scope, project_path, name, type, body, vars, tags, created_at, updated_at)
         VALUES ($id, $scope, $project, $name, $type, $body, $vars, $tags, $at, $at)
         ON CONFLICT (id) DO UPDATE SET name = $name, type = $type, body = $body, vars = $vars,
           tags = $tags, updated_at = $at`,
      )
      .run({
        $id: id,
        $scope: scope,
        $project: project,
        $name: def.name,
        $type: def.type,
        $body: (def.run ?? def.text) as string,
        $vars: JSON.stringify(def.vars),
        $tags: JSON.stringify(def.tags),
        $at: at,
      });
    return this.get(id);
  }

  private saveToFile(project: string, def: SnippetDef, previous: Snippet | null): Snippet {
    const loaded = this.loadFile(project);
    if (loaded && loaded.info.errors.length > 0) {
      throw new FlightdeckError(
        "invalid_state",
        "o .flightdeck/snippets.yaml tem erros: corrija antes de salvar",
      );
    }
    const defs = (loaded?.defs ?? []).filter((d) => d.name !== previous?.name);
    const at = previous
      ? (loaded?.defs ?? []).findIndex((d) => d.name === previous.name)
      : defs.length;
    defs.splice(at, 0, def);
    const text = toYaml(defs);
    // Every entry, the new one included, went through the secret scan: the repository may be public.
    this.writeFile(project, text);
    const id = fileId(project, def.name);
    if (previous && previous.id !== id) {
      this.opts.db.query("UPDATE snippet_marks SET id = ? WHERE id = ?").run(id, previous.id);
    }
    return this.get(id);
  }

  private writeFile(project: string, text: string): void {
    mkdirSync(join(project, ".flightdeck"), { recursive: true });
    writeFileSync(join(project, ".flightdeck", "snippets.yaml"), text);
  }

  /**
   * A YAML (or JSON, which YAML reads too) list of snippets: the valid ones, normalized and with
   * unique names, and why each of the others was left out. Shared by the versioned file and an
   * import from a file.
   */
  private parseList(text: string): { defs: SnippetDef[]; errors: string[] } {
    const errors: string[] = [];
    const defs: SnippetDef[] = [];
    let data: unknown;
    try {
      data = Bun.YAML.parse(text) ?? [];
    } catch (error) {
      errors.push(`YAML inválido: ${(error as Error).message}`);
      data = [];
    }
    if (!Array.isArray(data)) {
      errors.push("o arquivo precisa ser uma lista de snippets");
      data = [];
    }
    for (const [index, item] of (data as unknown[]).entries()) {
      const parsed = SnippetInput.safeParse(item);
      const label = parsed.success ? parsed.data.name : `entrada ${index + 1}`;
      if (!parsed.success) {
        errors.push(`${label}: ${(parsed.error.issues[0] as { message: string }).message}`);
        continue;
      }
      try {
        const def = normalizeSnippet(parsed.data, this.opts.scanner);
        if (defs.some((d) => d.name === def.name)) throw badRequest("nome repetido");
        defs.push(def);
      } catch (error) {
        errors.push(`${label}: ${(error as Error).message}`);
      }
    }
    return { defs, errors };
  }

  /** An import from a file: the snippets it holds, as the form would send them, and the reasons for the rest. */
  parse(text: string): { snippets: SnippetInput[]; errors: string[] } {
    const { defs, errors } = this.parseList(text);
    const snippets = defs.map(
      (def): SnippetInput => ({
        name: def.name,
        type: def.type,
        ...(def.type === "command" ? { run: def.run as string } : { text: def.text as string }),
        vars: def.vars,
        tags: def.tags,
      }),
    );
    return { snippets, errors };
  }

  /** The versioned file: what it holds that is valid, what is not and why, and whether it is trusted. */
  private loadFile(project: string): LoadedFile | null {
    const path = join(project, ".flightdeck", "snippets.yaml");
    if (!existsSync(path)) return null;
    const bytes = readFileSync(path);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const trusted =
      this.opts.db
        .query("SELECT 1 FROM snippet_trust WHERE project_path = ? AND hash = ?")
        .get(project, hash) !== null;
    const { defs, errors } = this.parseList(bytes.toString("utf8"));
    return { info: { path, hash, trusted, errors }, defs };
  }
}
