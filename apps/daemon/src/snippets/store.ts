import type { Database } from "bun:sqlite";
import {
  type Snippet,
  type SnippetFileInfo,
  type SnippetInput,
  SnippetVar,
} from "@flightdeck/protocol";
import { z } from "zod";
import { FlightdeckError, parseJsonOr, resolveAllowedCwd, ulid } from "../kernel/index.ts";
import { type Row, SnippetRows } from "./adapters/snippet-rows.ts";
import { readSnippetFile, writeSnippetFile } from "./adapters/snippet-yaml-file.ts";
import { fieldsOf, normalizeSnippet, type SecretScanner, type SnippetDef } from "./domain/model.ts";
import { fileId, parseFileId, parseSnippetList, toYaml } from "./domain/snippet-file.ts";

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

interface LoadedFile {
  info: SnippetFileInfo;
  defs: SnippetDef[];
}

const badRequest = (message: string, reason: string, params?: Record<string, string | number>) =>
  new FlightdeckError("bad_request", message, reason, params);
const notFound = () => new FlightdeckError("not_found", "snippet not found", "not_found");

/**
 * The snippets of this host (phase 18): the host's own, the project ones kept in the daemon, and
 * the ones in the project's versioned `.flightdeck/snippets.yaml`. A command from that file runs
 * only when its content is trusted by hash, like a workflow; pasting it never needs trust.
 */
export class Snippets {
  private readonly now: () => number;
  private readonly store: SnippetRows;

  constructor(private readonly opts: SnippetsOptions) {
    this.now = opts.now ?? Date.now;
    this.store = new SnippetRows(opts.db);
  }

  async list(
    filter: SnippetFilter,
  ): Promise<{ snippets: Snippet[]; file: SnippetFileInfo | null }> {
    const scope = filter.scope ?? "all";
    const project = filter.projectPath ? await this.project(filter.projectPath) : null;
    if (scope === "project" && !project)
      throw badRequest("the project scope needs projectPath", "scope_project_path");
    const views: Snippet[] = [];
    if (scope !== "project")
      views.push(...this.store.rows("host", null).map((row) => this.fromRow(row)));
    let file: SnippetFileInfo | null = null;
    if (scope !== "host" && project) {
      views.push(...this.store.rows("project", project).map((row) => this.fromRow(row)));
      const loaded = await this.loadFile(project);
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

  async get(id: string): Promise<Snippet> {
    const found = await this.lookup(id);
    if (!found) throw notFound();
    return found;
  }

  /** By name: the host's, then the project's. */
  async find(name: string, projectPath?: string): Promise<Snippet> {
    const { snippets } = await this.list(projectPath ? { projectPath } : {});
    const found = snippets.find((s) => s.name === name);
    if (!found) throw notFound();
    return found;
  }

  async save(input: SnippetSave): Promise<Snippet> {
    const { id, scope, target, projectPath, ...fields } = input;
    const def = normalizeSnippet(fields, this.opts.scanner);
    const project = scope === "project" ? await this.requireProject(projectPath) : null;
    const previous = id ? await this.lookup(id) : null;
    if (id && !previous) throw notFound();
    if (previous && (previous.scope !== scope || previous.projectPath !== project)) {
      throw badRequest("to change scope, create another snippet", "snippet_scope_fixed");
    }
    const toFile = scope === "project" && target === "file";
    if (previous && (previous.source === "file") !== toFile) {
      throw badRequest("to move a snippet, create another one", "snippet_place_fixed");
    }
    if (await this.nameTaken(scope, project, def.name, previous?.id ?? null)) {
      throw new FlightdeckError(
        "invalid_state",
        `a snippet named "${def.name}" already exists in this scope`,
        "name_taken",
        { name: def.name },
      );
    }
    return toFile
      ? await this.saveToFile(project as string, def, previous)
      : this.saveRow(scope, project, def, previous);
  }

  async remove(id: string): Promise<void> {
    const found = await this.get(id);
    if (found.source === "daemon") {
      this.store.remove(id);
    } else {
      const project = found.projectPath as string;
      const defs = ((await this.loadFile(project))?.defs ?? []).filter(
        (def) => def.name !== found.name,
      );
      await writeSnippetFile(project, toYaml(defs));
    }
    this.store.removeMark(id);
  }

  /** Trusts the content of the project's versioned file, by the hash the app was shown. */
  async trust(projectPath: string, hash: string): Promise<SnippetFileInfo> {
    const project = await this.project(projectPath);
    const loaded = await this.loadFile(project);
    if (!loaded)
      throw new FlightdeckError(
        "invalid_state",
        "the project has no .flightdeck/snippets.yaml",
        "snippet_file_missing",
      );
    if (loaded.info.hash !== hash) {
      throw new FlightdeckError(
        "invalid_state",
        "the file changed since it was shown: check again",
        "snippet_file_changed",
      );
    }
    this.store.trust(project, hash, new Date(this.now()).toISOString());
    return { ...loaded.info, trusted: true };
  }

  async favorite(id: string, favorite: boolean): Promise<Snippet> {
    await this.get(id);
    this.store.setFavorite(id, favorite);
    return await this.get(id);
  }

  /** A use of the snippet: counts toward "recent". */
  async markUsed(id: string): Promise<void> {
    await this.get(id);
    this.store.countUse(id, new Date(this.now()).toISOString());
  }

  // -- storage -------------------------------------------------------------------------------

  private async project(path: string): Promise<string> {
    return resolveAllowedCwd(path, this.opts.allowedRoots);
  }

  private async requireProject(path: string | undefined): Promise<string> {
    if (!path) throw badRequest("a project snippet needs projectPath", "snippet_project_path");
    return await this.project(path);
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
    const mark = this.store.mark(base.id);
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
      vars: parseJsonOr(z.record(z.string(), SnippetVar), row.vars, {}),
      tags: parseJsonOr(z.array(z.string()), row.tags, []),
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

  private async lookup(id: string): Promise<Snippet | null> {
    const parsed = parseFileId(id);
    if (parsed) {
      const project = await this.project(parsed.projectPath);
      const loaded = await this.loadFile(project);
      const def = loaded?.defs.find((d) => d.name === parsed.name);
      return def ? this.fromFile(project, def, loaded as LoadedFile) : null;
    }
    const row = this.store.row(id);
    return row ? this.fromRow(row) : null;
  }

  private async nameTaken(
    scope: "host" | "project",
    project: string | null,
    name: string,
    own: string | null,
  ): Promise<boolean> {
    const inRows = this.store
      .rows(scope, project)
      .some((row) => row.name === name && row.id !== own);
    const inFile = project
      ? ((await this.loadFile(project))?.defs ?? []).some(
          (def) => def.name === name && fileId(project, def.name) !== own,
        )
      : false;
    return inRows || inFile;
  }

  private async saveRow(
    scope: "host" | "project",
    project: string | null,
    def: SnippetDef,
    previous: Snippet | null,
  ): Promise<Snippet> {
    const at = new Date(this.now()).toISOString();
    const id = previous?.id ?? ulid(this.now());
    this.store.save({
      id,
      scope,
      project,
      name: def.name,
      type: def.type,
      body: (def.run ?? def.text) as string,
      vars: JSON.stringify(def.vars),
      tags: JSON.stringify(def.tags),
      at,
    });
    return await this.get(id);
  }

  private async saveToFile(
    project: string,
    def: SnippetDef,
    previous: Snippet | null,
  ): Promise<Snippet> {
    const loaded = await this.loadFile(project);
    if (loaded && loaded.info.errors.length > 0) {
      throw new FlightdeckError(
        "invalid_state",
        "the .flightdeck/snippets.yaml has errors: fix them before saving",
        "snippet_file_errors",
      );
    }
    const defs = (loaded?.defs ?? []).filter((d) => d.name !== previous?.name);
    const at = previous
      ? (loaded?.defs ?? []).findIndex((d) => d.name === previous.name)
      : defs.length;
    defs.splice(at, 0, def);
    const text = toYaml(defs);
    // Every entry, the new one included, went through the secret scan: the repository may be public.
    await writeSnippetFile(project, text);
    const id = fileId(project, def.name);
    if (previous && previous.id !== id) {
      this.store.moveMark(previous.id, id);
    }
    return await this.get(id);
  }

  /** An import from a file: the snippets it holds, as the form would send them, and the reasons for the rest. */
  parse(text: string): { snippets: SnippetInput[]; errors: string[] } {
    const { defs, errors } = parseSnippetList(text, this.opts.scanner);
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
  private async loadFile(project: string): Promise<LoadedFile | null> {
    const file = await readSnippetFile(project);
    if (!file) return null;
    const trusted = this.store.isTrusted(project, file.hash);
    const { defs, errors } = parseSnippetList(file.text, this.opts.scanner);
    return { info: { path: file.path, hash: file.hash, trusted, errors }, defs };
  }
}
