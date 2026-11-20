import type { Database } from "bun:sqlite";
import type {
  Persona,
  PersonaAgent,
  PersonaInput,
  PersonaProjectInfo,
  PersonaSubagents,
} from "@flightdeck/protocol";
import { byCodeUnit, inSequence, PersonaFields } from "@flightdeck/protocol";
import { FlightdeckError, parseJsonWith, resolveAllowedCwd } from "../kernel/index.ts";
import type { SecretScanner } from "../snippets/index.ts";
import {
  listPersonaNames,
  personaDir,
  readPersonaSource,
  removePersonaFile,
  writePersonaFile,
} from "./adapters/persona-files.ts";
import { PersonaRows } from "./adapters/persona-rows.ts";
import { previousPersonaId, renamedPersonaId } from "./domain/ids.ts";
import type { Language } from "./domain/language.ts";
import {
  normalizePersona,
  type PersonaDef,
  parsePersona,
  personaHash,
  serializePersona,
} from "./domain/model.ts";
import type { PersonaContext, PersonaRef, ResolvedPersona } from "./domain/prepare.ts";

export interface PersonasOptions {
  db: Database;
  allowedRoots: readonly string[];
  scanner: SecretScanner;
  now?: () => number;
  /** The personas that come ready, in a language (phase 20's pack). */
  pack?: (language: Language) => PersonaDef[];
  /** The project agent editor (phase 12), which writes `.claude/agents`; the integration plugs it in. */
  publisher?: { publish(request: AgentPublishRequest): Promise<{ path: string }> };
  /** Where a row the store cannot read is reported (by id, never by content). */
  log?: (message: string) => void;
}

/** A persona as a project agent file. */
export interface AgentPublishRequest extends PersonaAgent {
  projectPath: string;
  /** `persona-<id>`: the name of the agent and of its file. */
  name: string;
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
  private readonly store: PersonaRows;

  constructor(private readonly opts: PersonasOptions) {
    this.now = opts.now ?? Date.now;
    this.store = new PersonaRows(opts.db);
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
      this.store.saveHost(persona.id, JSON.stringify(persona), at);
      return this.hostViews().find((view) => view.id === persona.id) as Persona;
    }
    const project = await this.requireProject(request.projectPath);
    const source = serializePersona(persona);
    await writePersonaFile(project, persona.id, source);
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
    const mode = project ? this.store.subagentsMode(project) : "all";
    if (mode === "none") return { agents: {}, untrusted: [] };
    const loaded = project ? await this.loadProject(project) : null;
    const views = [
      ...(mode === "all" ? this.hostViews(ctx.language) : []),
      ...(loaded?.views.filter((view) => view.trusted) ?? []),
    ];
    const agents: Record<string, PersonaAgent> = {};
    for (const view of views) agents[`persona-${view.id}`] = agentOf(view);
    const untrusted = (loaded?.views ?? []).filter((view) => !view.trusted).map((view) => view.id);
    untrusted.sort(byCodeUnit);
    return { agents, untrusted };
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
  reset(asked: string, ctx: PersonaContext): Persona {
    const id = this.packId(asked, ctx.language);
    if (id === null) {
      throw badRequest("only the pack's personas go back to the original", "persona_pack_only");
    }
    this.store.removeHost(id);
    return this.hostViews(ctx.language).find((view) => view.id === id) as Persona;
  }

  async remove(scope: "host" | "project", id: string, projectPath?: string): Promise<void> {
    if (scope === "host") {
      // A person's own persona under an old id goes first; else the pack persona's edit that took its place.
      const renamed = renamedPersonaId(id);
      if (
        this.store.removeHost(id) === 0 &&
        (renamed === null || this.store.removeHost(renamed) === 0)
      ) {
        throw notFound();
      }
      return;
    }
    const project = await this.requireProject(projectPath);
    if (!(await removePersonaFile(project, id))) throw notFound();
    this.store.forgetTrust(project, id);
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

  /**
   * The project's persona with that id, else the host's. An id from before #3413 is looked up again
   * under its new id, in the host's personas and the pack's only (a cloned repository's file with
   * the new name is not what an old script meant); the new id also finds a project file that kept
   * the old one. Neither alias hides a persona that has the id asked for.
   */
  private async find(id: string, ctx: PersonaContext): Promise<Persona | null> {
    const loaded = ctx.projectPath
      ? await this.loadProject(await this.project(ctx.projectPath))
      : null;
    const inProject = (wanted: string) => loaded?.views.find((view) => view.id === wanted);
    const inHost = (wanted: string) =>
      this.hostViews(ctx.language).find((view) => view.id === wanted);
    const renamed = renamedPersonaId(id);
    const before = previousPersonaId(id);
    return (
      inProject(id) ??
      (before === null ? undefined : inProject(before)) ??
      inHost(id) ??
      (renamed === null ? undefined : inHost(renamed)) ??
      null
    );
  }

  /** The pack's id for what was asked (an old id included), or `null` when the pack has no such persona. */
  private packId(asked: string, language: Language | undefined): string | null {
    const pack = this.pack(language);
    // An old id that names a persona of the person's own is that persona, not the pack's.
    const own = this.hostViews(language).some((view) => view.id === asked);
    if (own && !pack.some((persona) => persona.id === asked)) return null;
    const id = pack.some((persona) => persona.id === asked) ? asked : renamedPersonaId(asked);
    return id !== null && pack.some((persona) => persona.id === id) ? id : null;
  }

  private pack(language: Language | undefined): PersonaDef[] {
    return this.opts.pack?.(language ?? "pt-BR") ?? [];
  }

  /** The pack in its order with the host's edits standing in for it, then the host's own. */
  private hostViews(language?: Language): Persona[] {
    const rows = this.store.hostRows();
    // A row that no longer fits (written by a newer daemon, or edited by hand) leaves the others be.
    // Its id is held back from the pack too: a stricter edit must not give way to the wider original.
    const unreadable = new Set<string>();
    const edited = rows.flatMap((row) => {
      try {
        const persona = parseJsonWith(PersonaFields, row.data);
        if (persona.id !== row.id) throw new Error("the row names another persona");
        return [persona];
      } catch (error) {
        unreadable.add(row.id);
        this.opts.log?.(`personas: ${row.id} is unreadable: ${(error as Error).message}`);
        return [];
      }
    });
    const view = (persona: PersonaDef, scope: "pack" | "host", modified: boolean): Persona => ({
      ...persona,
      scope,
      hash: null,
      trusted: true,
      modified,
    });
    const packed = this.pack(language).filter((persona) => !unreadable.has(persona.id));
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
    this.store.trust(project, id, hash, new Date(this.now()).toISOString());
  }

  /** The project's personas: what is valid, what is not and why, and which are trusted. */
  private async loadProject(project: string): Promise<LoadedProject | null> {
    const names = await listPersonaNames(project);
    if (names === null) return null;
    const views: Persona[] = [];
    const errors: string[] = [];
    await inSequence(names, async (name) => {
      const id = name.slice(0, -3);
      try {
        const source = await readPersonaSource(project, name);
        const persona = normalizePersona(parsePersona(source, id), this.opts.scanner);
        const hash = personaHash(source);
        const trusted = this.store.isTrusted(project, id, hash);
        views.push({ ...persona, scope: "project", hash, trusted, modified: false });
      } catch (error) {
        errors.push(`${name}: ${(error as Error).message}`);
      }
    });
    return { info: { path: personaDir(project), errors }, views };
  }
}
