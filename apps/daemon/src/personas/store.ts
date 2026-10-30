import type { Database } from "bun:sqlite";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Persona, PersonaInput, PersonaProjectInfo } from "@flightdeck/protocol";
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
}

/** What names a persona: its id in the host's or the project's list, or a definition from the app. */
export interface PersonaRef {
  id?: string;
  definition?: unknown;
}

export interface PersonaContext {
  projectPath?: string | undefined;
  /** The language of the pack personas; `pt-BR` when absent. */
  language?: Language | undefined;
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

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_FILE_BYTES = 64 * 1024;

const badRequest = (message: string) => new FlightdeckError("bad_request", message);
const notFound = () => new FlightdeckError("not_found", "persona não encontrada");

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

  list(filter: { scope?: "host" | "project" | "all"; projectPath?: string; language?: Language }): {
    personas: Persona[];
    project: PersonaProjectInfo | null;
  } {
    const scope = filter.scope ?? "all";
    const project = filter.projectPath ? this.project(filter.projectPath) : null;
    if (scope === "project" && !project) throw badRequest("o escopo project pede projectPath");
    const personas: Persona[] = [];
    if (scope !== "project") personas.push(...this.hostViews(filter.language));
    let info: PersonaProjectInfo | null = null;
    if (scope !== "host" && project) {
      const loaded = this.loadProject(project);
      info = loaded?.info ?? null;
      personas.push(...(loaded?.views ?? []));
    }
    return { personas, project: info };
  }

  /** The project's persona with that id, else the host's. */
  get(id: string, ctx: PersonaContext): Persona {
    const found = this.find(id, ctx);
    if (!found) throw notFound();
    return found;
  }

  save(request: {
    scope: "host" | "project";
    projectPath?: string;
    persona: PersonaInput;
  }): Persona {
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
    const project = this.requireProject(request.projectPath);
    const source = serializePersona(persona);
    mkdirSync(this.dir(project), { recursive: true });
    writeFileSync(this.file(project, persona.id), source);
    // It came from the app, from the person: no need to ask them to trust what they just wrote.
    this.trustHash(project, persona.id, personaHash(source));
    return this.get(persona.id, { projectPath: project });
  }

  /** Puts a pack persona back as it came: the host's edit goes away. */
  reset(id: string, ctx: PersonaContext): Persona {
    if (!this.pack(ctx.language).some((persona) => persona.id === id)) {
      throw badRequest("só as personas do pacote voltam ao original");
    }
    this.opts.db.query("DELETE FROM personas WHERE id = ?").run(id);
    return this.hostViews(ctx.language).find((view) => view.id === id) as Persona;
  }

  remove(scope: "host" | "project", id: string, projectPath?: string): void {
    if (scope === "host") {
      const done = this.opts.db.query("DELETE FROM personas WHERE id = ?").run(id);
      if (done.changes === 0) throw notFound();
      return;
    }
    const project = this.requireProject(projectPath);
    const file = this.file(project, id);
    if (!existsSync(file)) throw notFound();
    rmSync(file);
    this.opts.db
      .query("DELETE FROM persona_trust WHERE project_path = ? AND id = ?")
      .run(project, id);
  }

  /** Trusts the versioned persona as it is now, by the hash the app was shown. */
  trust(projectPath: string, id: string, hash: string): Persona {
    const project = this.project(projectPath);
    const current = this.loadProject(project)?.views.find((view) => view.id === id);
    if (!current) throw notFound();
    if (current.hash !== hash) {
      throw new FlightdeckError(
        "invalid_state",
        "a persona mudou desde que foi mostrada: confira de novo",
      );
    }
    this.trustHash(project, id, hash);
    return { ...current, trusted: true };
  }

  /** The persona to use: an id (the project's, else the host's) or a definition from the app. */
  resolve(ref: PersonaRef, ctx: PersonaContext): ResolvedPersona {
    if ((ref.id === undefined) === (ref.definition === undefined)) {
      throw badRequest("informe a persona por id ou por definition, uma das duas");
    }
    if (ref.definition !== undefined) {
      return {
        persona: normalizePersona(ref.definition, this.opts.scanner),
        source: "inline",
        hash: null,
      };
    }
    const view = this.get(ref.id as string, ctx);
    if (!view.trusted) {
      throw new FlightdeckError(
        "persona_untrusted",
        `a persona ${view.id} vem do projeto e muda o comportamento do agente: confie nela antes de usar`,
      );
    }
    const { scope, hash, trusted, modified, ...persona } = view;
    return { persona, source: scope, hash };
  }

  // -- storage -------------------------------------------------------------------------------

  private project(path: string): string {
    return resolveAllowedCwd(path, this.opts.allowedRoots);
  }

  private requireProject(path: string | undefined): string {
    if (!path) throw badRequest("uma persona de projeto pede projectPath");
    return this.project(path);
  }

  private dir(project: string): string {
    return join(project, ".flightdeck", "personas");
  }

  private file(project: string, id: string): string {
    if (!ID.test(id)) throw badRequest("id inválido");
    return join(this.dir(project), `${id}.md`);
  }

  private find(id: string, ctx: PersonaContext): Persona | null {
    if (ctx.projectPath) {
      const project = this.project(ctx.projectPath);
      const inProject = this.loadProject(project)?.views.find((view) => view.id === id);
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

  private trustHash(project: string, id: string, hash: string): void {
    this.opts.db
      .query(
        "INSERT OR IGNORE INTO persona_trust (project_path, id, hash, trusted_at) VALUES (?, ?, ?, ?)",
      )
      .run(project, id, hash, new Date(this.now()).toISOString());
  }

  /** The project's personas: what is valid, what is not and why, and which are trusted. */
  private loadProject(project: string): LoadedProject | null {
    const dir = this.dir(project);
    if (!existsSync(dir)) return null;
    const views: Persona[] = [];
    const errors: string[] = [];
    for (const name of readdirSync(dir)
      .filter((entry) => entry.endsWith(".md"))
      .sort()) {
      const id = name.slice(0, -3);
      const path = join(dir, name);
      try {
        if (statSync(path).size > MAX_FILE_BYTES) throw badRequest("arquivo grande demais");
        const source = readFileSync(path, "utf8");
        const persona = normalizePersona(parsePersona(source, id), this.opts.scanner);
        const hash = personaHash(source);
        const trusted =
          this.opts.db
            .query("SELECT 1 FROM persona_trust WHERE project_path = ? AND id = ? AND hash = ?")
            .get(project, id, hash) !== null;
        views.push({ ...persona, scope: "project", hash, trusted, modified: false });
      } catch (error) {
        errors.push(`${name}: ${(error as Error).message}`);
      }
    }
    return { info: { path: dir, errors }, views };
  }
}
