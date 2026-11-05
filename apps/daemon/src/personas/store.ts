import type { Database } from "bun:sqlite";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  Persona,
  PersonaAgent,
  PersonaInput,
  PersonaProjectInfo,
  PersonaSubagents,
  PersonaSubagentsMode,
} from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import { resolveAllowedCwd } from "../paths.ts";
import type { SecretScanner } from "../snippets/model.ts";
import {
  normalizePersona,
  type PersonaDef,
  parsePersona,
  personaHash,
  serializePersona,
} from "./model.ts";
import type { Language } from "./pack.ts";

export interface PersonasOptions {
  db: Database;
  allowedRoots: readonly string[];
  scanner: SecretScanner;
  now?: () => number;
  /** The personas that come ready, in a language (phase 20's pack). */
  pack?: (language: Language) => PersonaDef[];
  /** The project agent editor (phase 12), which writes `.claude/agents`; the integration plugs it in. */
  publisher?: { publish(request: AgentPublishRequest): Promise<{ path: string }> };
}

/** A persona as a project agent file. */
export interface AgentPublishRequest extends PersonaAgent {
  projectPath: string;
  /** `persona-<id>`: the name of the agent and of its file. */
  name: string;
}

/** What names a persona: its id in the host's or the project's list, or a definition from the app. */
export interface PersonaRef {
  id?: string;
  definition?: unknown;
  /** The language of the pack personas (the context's is used when absent). */
  language?: Language;
}

export interface PersonaContext {
  projectPath?: string;
  /** The language of the pack personas; `pt-BR` when absent. */
  language?: Language;
}

export interface ResolvedPersona {
  persona: PersonaDef;
  source: "project" | "host" | "pack" | "inline";
  /** The hash of the versioned file, for the ones from a project. */
  hash: string | null;
}

interface LoadedProject {
  info: PersonaProjectInfo;
  views: Persona[];
}

/** The persona as an agent definition: the tools and the model only when it names them. */
function agentOf(persona: PersonaDef): PersonaAgent {
  return {
    description: persona.description,
    prompt: persona.body,
    ...(persona.tools ? { tools: persona.tools } : {}),
    ...(persona.model ? { model: persona.model } : {}),
  };
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_FILE_BYTES = 64 * 1024;

const badRequest = (message: string, reason: string, params?: Record<string, string | number>) =>
  new FlightdeckError("bad_request", message, reason, params);
const notFound = () => new FlightdeckError("not_found", "persona not found", "persona_not_found");

/**
 * The personas of this host (phase 20): the host's own (in the daemon) and a project's, kept as
 * `.flightdeck/personas/<id>.md` and versioned. A versioned one changes how the agent behaves, so
 * it is trusted by the hash of its file before the first use, like a workflow. The global ones
 * belong to the app, which hands them over whole (`PersonaRef.definition`).
 */
export class Personas {
  private readonly now: () => number;

  constructor(private readonly opts: PersonasOptions) {
    this.now = opts.now ?? Date.now;
  }

  async list(filter: {
    scope?: "host" | "project" | "all";
    projectPath?: string;
    language?: Language;
  }): Promise<{
    personas: Persona[];
    project: PersonaProjectInfo | null;
  }> {
    const scope = filter.scope ?? "all";
    const project = filter.projectPath ? await this.project(filter.projectPath) : null;
    if (scope === "project" && !project)
      throw badRequest("the project scope needs projectPath", "scope_project_path");
    const personas: Persona[] = [];
    if (scope !== "project") personas.push(...this.hostViews(filter.language));
    let info: PersonaProjectInfo | null = null;
    if (scope !== "host" && project) {
      const loaded = await this.loadProject(project);
      info = loaded?.info ?? null;
      personas.push(...(loaded?.views ?? []));
    }
    return { personas, project: info };
  }

  /** The project's persona with that id, else the host's. */
  async get(id: string, ctx: PersonaContext): Promise<Persona> {
    const found = await this.find(id, ctx);
    if (!found) throw notFound();
    return found;
  }

  async save(request: {
    scope: "host" | "project";
    projectPath?: string;
    persona: PersonaInput;
  }): Promise<Persona> {
    const persona = normalizePersona(request.persona, this.opts.scanner);
    if (request.scope === "host") {
      const at = new Date(this.now()).toISOString();
      this.opts.db
        .query(
          `INSERT INTO personas (id, data, created_at, updated_at) VALUES ($id, $data, $at, $at)
           ON CONFLICT (id) DO UPDATE SET data = $data, updated_at = $at`,
        )
        .run({ $id: persona.id, $data: JSON.stringify(persona), $at: at });
      return this.hostViews().find((view) => view.id === persona.id) as Persona;
    }
    const project = await this.requireProject(request.projectPath);
    const source = serializePersona(persona);
    await mkdir(this.dir(project), { recursive: true });
    await writeFile(this.file(project, persona.id), source);
    // It came from the app, from the person: no need to ask them to trust what they just wrote.
    this.trustHash(project, persona.id, personaHash(source));
    return await this.get(persona.id, { projectPath: project });
  }

  /**
   * Every persona that holds in the project as an agent `persona-<id>`: the pack's, the host's
   * and the project's trusted ones, the project's winning. A versioned one without trust is left
   * out, and does not stand in for another of the same id.
   */
  async subagents(ctx: PersonaContext): Promise<PersonaSubagents> {
    const project = await this.optionalProject(ctx.projectPath);
    const mode = project ? this.subagentsMode(project) : "all";
    if (mode === "none") return { agents: {}, untrusted: [] };
    const loaded = project ? await this.loadProject(project) : null;
    const views = [
      ...(mode === "all" ? this.hostViews(ctx.language) : []),
      ...(loaded?.views.filter((view) => view.trusted) ?? []),
    ];
    const agents: Record<string, PersonaAgent> = {};
    for (const view of views) agents[`persona-${view.id}`] = agentOf(view);
    const untrusted = (loaded?.views ?? []).filter((view) => !view.trusted).map((view) => view.id);
    return { agents, untrusted: untrusted.sort((a, b) => a.localeCompare(b, "en")) };
  }

  /** Writes the persona as the project's agent `persona-<id>`, through the agent editor. */
  async publishAgent(request: {
    id: string;
    projectPath: string;
    language?: Language;
    confirm: boolean;
  }): Promise<{ path: string }> {
    if (!request.confirm) {
      throw new FlightdeckError(
        "invalid_state",
        "publishing as a project agent needs confirm: true",
        "persona_publish_confirm",
      );
    }
    const publisher = this.opts.publisher;
    if (!publisher) {
      throw new FlightdeckError(
        "invalid_state",
        "the project's agent editor is not available",
        "persona_publisher_off",
      );
    }
    const projectPath = await this.project(request.projectPath);
    const { persona } = await this.resolve(
      { id: request.id },
      { projectPath, language: request.language },
    );
    return publisher.publish({
      projectPath,
      name: `persona-${persona.id}`,
      ...agentOf(persona),
    });
  }

  /** Puts a pack persona back as it came: the host's edit goes away. */
  reset(id: string, ctx: PersonaContext): Persona {
    if (!this.pack(ctx.language).some((persona) => persona.id === id)) {
      throw badRequest("only the pack's personas go back to the original", "persona_pack_only");
    }
    this.opts.db.query("DELETE FROM personas WHERE id = ?").run(id);
    return this.hostViews(ctx.language).find((view) => view.id === id) as Persona;
  }

  async remove(scope: "host" | "project", id: string, projectPath?: string): Promise<void> {
    if (scope === "host") {
      const done = this.opts.db.query("DELETE FROM personas WHERE id = ?").run(id);
      if (done.changes === 0) throw notFound();
      return;
    }
    const project = await this.requireProject(projectPath);
    const file = this.file(project, id);
    await rm(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw notFound();
      throw error;
    });
    this.opts.db
      .query("DELETE FROM persona_trust WHERE project_path = ? AND id = ?")
      .run(this.trustFolder(project), id);
  }

  /** Trusts the versioned persona as it is now, by the hash the app was shown. */
  async trust(projectPath: string, id: string, hash: string): Promise<Persona> {
    const project = await this.project(projectPath);
    const current = (await this.loadProject(project))?.views.find((view) => view.id === id);
    if (!current) throw notFound();
    if (current.hash !== hash) {
      throw new FlightdeckError(
        "invalid_state",
        "the persona changed since it was shown: check again",
        "persona_changed",
      );
    }
    this.trustHash(project, id, hash);
    return { ...current, trusted: true };
  }

  /** The persona to use: an id (the project's, else the host's) or a definition from the app. */
  async resolve(ref: PersonaRef, ctx: PersonaContext): Promise<ResolvedPersona> {
    if ((ref.id === undefined) === (ref.definition === undefined)) {
      throw badRequest(
        "give the persona by id or by definition, one of the two",
        "persona_ref_needed",
      );
    }
    if (ref.definition !== undefined) {
      return {
        persona: normalizePersona(ref.definition, this.opts.scanner),
        source: "inline",
        hash: null,
      };
    }
    const view = await this.get(ref.id as string, {
      projectPath: ctx.projectPath,
      language: ref.language ?? ctx.language,
    });
    if (!view.trusted) {
      throw new FlightdeckError(
        "persona_untrusted",
        `the persona ${view.id} comes from the project and changes the agent's behavior: trust it before using it`,
        "persona_untrusted_project",
        { id: view.id },
      );
    }
    const { scope, hash, trusted, modified, ...persona } = view;
    return { persona, source: scope, hash };
  }

  // -- storage -------------------------------------------------------------------------------

  private async project(path: string): Promise<string> {
    return resolveAllowedCwd(path, this.opts.allowedRoots);
  }

  /** What the project of a folder (or of a card's worktree) offers as subagents; all by default. */
  private subagentsMode(folder: string): PersonaSubagentsMode {
    const row = this.opts.db
      .query(
        `SELECT persona_subagents AS mode FROM projects WHERE path = $folder
         UNION ALL
         SELECT p.persona_subagents FROM cards c JOIN projects p ON p.id = c.project_id
          WHERE c.worktree_path = $folder LIMIT 1`,
      )
      .get({ $folder: folder }) as { mode: PersonaSubagentsMode | null } | null;
    return row?.mode ?? "all";
  }

  /** A folder the daemon does not allow has no personas of its own. */
  private async optionalProject(path: string | undefined): Promise<string | null> {
    if (!path) return null;
    try {
      return await this.project(path);
    } catch {
      // resolveAllowedCwd only ever refuses with forbidden_cwd.
      return null;
    }
  }

  private async requireProject(path: string | undefined): Promise<string> {
    if (!path) throw badRequest("a project persona needs projectPath", "persona_project_path");
    return await this.project(path);
  }

  private dir(project: string): string {
    return join(project, ".flightdeck", "personas");
  }

  private file(project: string, id: string): string {
    if (!ID.test(id)) throw badRequest("invalid id", "persona_id_invalid");
    return join(this.dir(project), `${id}.md`);
  }

  private async find(id: string, ctx: PersonaContext): Promise<Persona | null> {
    if (ctx.projectPath) {
      const project = await this.project(ctx.projectPath);
      const inProject = (await this.loadProject(project))?.views.find((view) => view.id === id);
      if (inProject) return inProject;
    }
    return this.hostViews(ctx.language).find((view) => view.id === id) ?? null;
  }

  private pack(language: Language | undefined): PersonaDef[] {
    return this.opts.pack?.(language ?? "pt-BR") ?? [];
  }

  /** The pack in its order with the host's edits standing in for it, then the host's own. */
  private hostViews(language?: Language): Persona[] {
    const rows = this.opts.db.query("SELECT data FROM personas ORDER BY id").all() as Array<{
      data: string;
    }>;
    const edited = rows.map((row) => JSON.parse(row.data) as PersonaDef);
    const view = (persona: PersonaDef, scope: "pack" | "host", modified: boolean): Persona => ({
      ...persona,
      scope,
      hash: null,
      trusted: true,
      modified,
    });
    const packed = this.pack(language);
    const views = packed.map((persona) => {
      const mine = edited.find((candidate) => candidate.id === persona.id);
      return mine ? view(mine, "host", true) : view(persona, "pack", false);
    });
    for (const persona of edited) {
      if (!packed.some((candidate) => candidate.id === persona.id)) {
        views.push(view(persona, "host", false));
      }
    }
    return views;
  }

  /** The folder trust is kept under: a card's worktree answers for the project it was made from. */
  private trustFolder(folder: string): string {
    const row = this.opts.db
      .query(
        `SELECT p.path FROM cards c JOIN projects p ON p.id = c.project_id
         WHERE c.worktree_path = ?`,
      )
      .get(folder) as { path: string } | null;
    return row?.path ?? folder;
  }

  private trustHash(project: string, id: string, hash: string): void {
    this.opts.db
      .query(
        "INSERT OR IGNORE INTO persona_trust (project_path, id, hash, trusted_at) VALUES (?, ?, ?, ?)",
      )
      .run(this.trustFolder(project), id, hash, new Date(this.now()).toISOString());
  }

  /** The project's personas: what is valid, what is not and why, and which are trusted. */
  private async loadProject(project: string): Promise<LoadedProject | null> {
    const dir = this.dir(project);
    const names = await readdir(dir).then(
      (entries) => entries,
      () => null,
    );
    if (names === null) return null;
    const views: Persona[] = [];
    const errors: string[] = [];
    for (const name of names.filter((entry) => entry.endsWith(".md")).sort()) {
      const id = name.slice(0, -3);
      const path = join(dir, name);
      try {
        if ((await stat(path)).size > MAX_FILE_BYTES)
          throw badRequest("file too big", "persona_file_big");
        const source = await readFile(path, "utf8");
        const persona = normalizePersona(parsePersona(source, id), this.opts.scanner);
        const hash = personaHash(source);
        const trusted =
          this.opts.db
            .query("SELECT 1 FROM persona_trust WHERE project_path = ? AND id = ? AND hash = ?")
            .get(this.trustFolder(project), id, hash) !== null;
        views.push({ ...persona, scope: "project", hash, trusted, modified: false });
      } catch (error) {
        errors.push(`${name}: ${(error as Error).message}`);
      }
    }
    return { info: { path: dir, errors }, views };
  }
}
