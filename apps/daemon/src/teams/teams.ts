/**
 * Phase 21: teams. A coordinator session and workers with cards of their own, started together
 * with the instructions of coordination, paused by the plan quota and resumed with it.
 */
import type { Database } from "bun:sqlite";
import type {
  MessageInfo,
  TeamInfo,
  TeamMember,
  TeamStatus,
  TeamsUpdatedFrame,
} from "@flightdeck/protocol";
import type { Board } from "../board/board.ts";
import { FlightdeckError } from "../errors.ts";
import { MANAGED_STATE } from "../messaging/endpoints.ts";
import type { Messaging } from "../messaging/messages.ts";
import type { Quota } from "../quota/quota.ts";
import type { SessionManager } from "../sessions/session-manager.ts";
import { ulid } from "../ulid.ts";
import {
  coordinatorInstructions,
  INSTRUCTIONS_VERSION,
  type TeamBrief,
  workerInstructions,
} from "./instructions.ts";

/** The personas of phase 20 plug in here. */
export interface TeamPersonas {
  resolve(id: string): { id: string; name: string } | null;
}

export interface TeamsOptions {
  db: Database;
  board: Board;
  manager: SessionManager;
  messaging: Messaging;
  host: string;
  quota?: Pick<Quota, "watch" | "blocked"> | undefined;
  personas?: TeamPersonas | undefined;
  clock?: (() => number) | undefined;
  /** Starts the coordinator session; phase 20 passes the persona on. */
  startCoordinator?:
    | ((input: { cwd: string; prompt: string; name: string; persona: string | null }) => {
        sessionId: string;
      })
    | undefined;
  /** Starts a worker's card; phase 20 passes the persona on. */
  startWorker?: ((cardId: string, persona: string | null) => Promise<unknown>) | undefined;
  /** Tells a running session its persona changed. */
  applyPersona?: ((sessionId: string, persona: string | null) => void) | undefined;
}

export interface NewTeam {
  projectId: string;
  goal: string;
  name?: string | undefined;
  workers: number;
  coordinatorPersona?: string | undefined;
  workerPersonas?: string[] | undefined;
  checks?: string[] | undefined;
}

export interface TeamPatch {
  team: string;
  goal?: string | undefined;
  checks?: string[] | undefined;
  persona?: { member: string; persona: string | null } | undefined;
  addWorkers?: number | undefined;
  removeMember?: string | undefined;
}

/** What a team keeps of a member; the live session of a worker comes from its card. */
interface StoredMember {
  name: string;
  role: "coordinator" | "worker";
  persona: string | null;
  cardId: string | null;
  sessionId: string | null;
}

interface Row {
  id: string;
  name: string;
  project_id: string;
  goal: string;
  coordinator: string | null;
  members: string;
  checks: string;
  state: TeamInfo["state"];
  paused_by: TeamInfo["pausedBy"];
  instructions_version: string;
  created_at: string;
}

/**
 * The name the cards and sessions of a team carry. A card's branch comes from its title cut short,
 * so a long team name would give every worker the same branch: it is cut before the number.
 */
const label = (name: string): string => name.slice(0, 24).trimEnd();

const bad = (message: string) => new FlightdeckError("bad_request", message);
const invalid = (message: string) => new FlightdeckError("invalid_state", message);
const notFound = (message: string) => new FlightdeckError("not_found", message);

const STOP_USER =
  'STOP: o time foi pausado. Termine o passo em andamento, feche num ponto seguro (um commit verde ou um stash) e pare até chegar a mensagem "resume". Não despache, não integre e não comece nada novo.';
const STOP_QUOTA =
  'STOP: a cota do plano chegou ao limite e o time foi pausado. Termine o passo em andamento, feche num ponto seguro (um commit verde ou um stash) e pare até chegar a mensagem "resume", que vem quando a janela da cota reiniciar.';
const RESUME_USER = "resume: o time voltou a trabalhar. Continue de onde parou.";
const RESUME_QUOTA =
  "resume: a janela da cota do plano reiniciou e o time voltou a trabalhar. Continue de onde parou.";

export class Teams {
  private readonly listeners = new Set<(frame: TeamsUpdatedFrame) => void>();
  private readonly unsubscribe: Array<() => void> = [];
  private blocked: boolean;

  constructor(private readonly opts: TeamsOptions) {
    this.blocked = opts.quota?.blocked() != null;
    if (opts.quota) this.unsubscribe.push(opts.quota.watch(() => this.onQuota()));
  }

  private now(): string {
    return new Date((this.opts.clock ?? Date.now)()).toISOString();
  }

  watch(listener: (frame: TeamsUpdatedFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  stop(): void {
    for (const off of this.unsubscribe.splice(0)) off();
    this.listeners.clear();
  }

  // --- reading ---

  private row(id: string): Row {
    const row = this.opts.db.query("SELECT * FROM teams WHERE id = ?").get(id) as Row | null;
    if (!row) throw notFound(`time ${id} não existe`);
    return row;
  }

  private stored(row: Row): StoredMember[] {
    return JSON.parse(row.members) as StoredMember[];
  }

  /** A member as the app sees it: the worker's session is the one its card is running now. */
  private member(stored: StoredMember): TeamMember {
    let sessionId = stored.sessionId;
    let state: TeamMember["sessionState"] = null;
    if (stored.role === "worker" && stored.cardId) {
      const card = this.opts.board.getCard(stored.cardId);
      sessionId = card.sessionId;
      state = card.sessionStatus ? MANAGED_STATE[card.sessionStatus] : null;
    } else if (sessionId) {
      state = MANAGED_STATE[this.opts.manager.get(sessionId).status];
    }
    return {
      name: stored.name,
      role: stored.role,
      persona: stored.persona,
      cardId: stored.cardId,
      sessionId,
      address: sessionId ? `${this.opts.host}/${sessionId}` : null,
      sessionState: state,
    };
  }

  private info(row: Row): TeamInfo {
    return {
      id: row.id,
      name: row.name,
      projectId: row.project_id,
      goal: row.goal,
      coordinator: row.coordinator,
      members: this.stored(row).map((m) => this.member(m)),
      checks: JSON.parse(row.checks) as string[],
      state: row.state,
      pausedBy: row.paused_by,
      instructionsVersion: row.instructions_version,
      createdAt: row.created_at,
    };
  }

  list(projectId?: string): TeamInfo[] {
    const rows = this.opts.db
      .query(
        "SELECT * FROM teams WHERE (?1 IS NULL OR project_id = ?1) ORDER BY created_at DESC, rowid DESC",
      )
      .all(projectId ?? null) as Row[];
    return rows.map((row) => this.info(row));
  }

  get(id: string): TeamInfo {
    return this.info(this.row(id));
  }

  /** The team a session belongs to (as coordinator or worker), if it is still running. */
  teamOf(sessionId: string): string | null {
    const rows = this.opts.db.query("SELECT * FROM teams WHERE state <> 'closed'").all() as Row[];
    for (const row of rows) {
      if (this.info(row).members.some((m) => m.sessionId === sessionId)) return row.id;
    }
    return null;
  }

  status(id: string): TeamStatus {
    const team = this.get(id);
    const messages = this.opts.messaging
      .list({ team: id, days: 365, limit: 1000 })
      .filter((m) => m.kind === "session");
    const last = (member: TeamMember): MessageInfo | undefined =>
      messages.find((m) => m.fromSession === member.sessionId);
    return {
      team,
      messages: messages.length,
      members: team.members.map((member) => {
        const report = last(member);
        return {
          ...member,
          lastReport: report ? { text: report.text, at: report.createdAt } : null,
          sent: messages.filter((m) => m.fromSession === member.sessionId).length,
          received: messages.filter((m) => m.toSession === member.sessionId).length,
        };
      }),
    };
  }

  // --- creating ---

  private checkPersona(id: string | null | undefined): string | null {
    if (id === null || id === undefined) return null;
    const found = this.opts.personas?.resolve(id);
    if (!found) throw bad(`a persona ${id} não existe`);
    return found.id;
  }

  /** Creates a worker's card with its instructions and starts it (the quota queue still applies). */
  private async startWorker(
    team: { name: string; goal: string; checks: string[]; projectId: string },
    name: string,
    persona: string | null,
    coordinator: string | null,
  ): Promise<StoredMember> {
    const brief: TeamBrief = { ...team, workers: [] };
    const card = this.opts.board.createCard(team.projectId, {
      title: name,
      description: workerInstructions(brief, coordinator),
    });
    await (this.opts.startWorker
      ? this.opts.startWorker(card.id, persona)
      : this.opts.board.startCard(card.id));
    return { name, role: "worker", persona, cardId: card.id, sessionId: null };
  }

  async create(input: NewTeam): Promise<TeamInfo> {
    const project = this.opts.board.getProject(input.projectId);
    const blocked = this.opts.quota?.blocked();
    if (blocked) {
      const until = blocked.until ? new Date(blocked.until).toISOString() : "o próximo reinício";
      throw invalid(
        `a cota do plano está acima do limite até ${until}: crie o time depois, senão ele nasce parado`,
      );
    }
    const coordinatorPersona = this.checkPersona(input.coordinatorPersona);
    const workerPersonas = (input.workerPersonas ?? []).map((p) => this.checkPersona(p));
    const name = input.name ?? input.goal.slice(0, 40);
    const checks = input.checks ?? [];
    const id = ulid((this.opts.clock ?? Date.now)());
    const workerNames = Array.from(
      { length: input.workers },
      (_, i) => `${label(name)} · executora ${i + 1}`,
    );
    const team = { name, goal: input.goal, checks, projectId: project.id };

    const prompt = coordinatorInstructions({
      ...team,
      workers: workerNames.map((n, i) => ({
        name: n,
        persona: workerPersonas[i] ?? null,
        cardId: null,
      })),
    });
    const startCoordinator =
      this.opts.startCoordinator ??
      ((start: { cwd: string; prompt: string; name: string }) =>
        this.opts.manager.create({ cwd: start.cwd, prompt: start.prompt, name: start.name }));
    const coordinatorName = `${label(name)} · coordenadora`;
    const { sessionId } = startCoordinator({
      cwd: project.path,
      prompt,
      name: coordinatorName,
      persona: coordinatorPersona,
    });
    const address = `${this.opts.host}/${sessionId}`;
    const members: StoredMember[] = [
      {
        name: coordinatorName,
        role: "coordinator",
        persona: coordinatorPersona,
        cardId: null,
        sessionId,
      },
    ];
    for (const [i, workerName] of workerNames.entries()) {
      members.push(await this.startWorker(team, workerName, workerPersonas[i] ?? null, address));
    }
    this.opts.db
      .query(
        `INSERT INTO teams (id, name, project_id, goal, coordinator, members, checks, state,
                            paused_by, instructions_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?)`,
      )
      .run(
        id,
        name,
        project.id,
        input.goal,
        sessionId,
        JSON.stringify(members),
        JSON.stringify(checks),
        INSTRUCTIONS_VERSION,
        this.now(),
      );
    return this.changed(id);
  }

  // --- changing ---

  private open(id: string): Row {
    const row = this.row(id);
    if (row.state === "closed") throw invalid(`o time ${row.name} está encerrado`);
    return row;
  }

  private changed(id: string, reason: string | null = null): TeamInfo {
    const info = this.get(id);
    for (const listener of this.listeners) listener({ type: "teams.updated", team: info, reason });
    return info;
  }

  private save(id: string, patch: Partial<Record<string, string | null>>): void {
    for (const [column, value] of Object.entries(patch)) {
      this.opts.db.query(`UPDATE teams SET ${column} = ? WHERE id = ?`).run(value ?? null, id);
    }
  }

  /** A notice from Flightdeck to every member that has a session. */
  private notify(
    info: TeamInfo,
    text: string,
    only?: (member: TeamMember) => boolean,
  ): { delivered: number; refused: number } {
    let delivered = 0;
    let refused = 0;
    for (const member of info.members) {
      if (!member.sessionId || (only && !only(member))) continue;
      const result = this.opts.messaging.notice(member.sessionId, "system", text, info.id);
      if (result.status === "refused") refused++;
      else delivered++;
    }
    return { delivered, refused };
  }

  pause(id: string, by: "user" | "quota" = "user"): TeamInfo {
    const row = this.open(id);
    if (row.state === "paused") return this.get(id);
    this.save(id, { state: "paused", paused_by: by });
    const info = this.get(id);
    this.notify(info, by === "quota" ? STOP_QUOTA : STOP_USER);
    return this.changed(
      id,
      by === "quota" ? "a cota do plano passou do limite: o time foi pausado" : null,
    );
  }

  resume(id: string, by: "user" | "quota" = "user"): TeamInfo {
    const row = this.open(id);
    if (row.state === "active") return this.get(id);
    this.save(id, { state: "active", paused_by: null });
    this.notify(this.get(id), by === "quota" ? RESUME_QUOTA : RESUME_USER);
    return this.changed(
      id,
      by === "quota" ? "a cota do plano reiniciou: o time voltou a trabalhar" : null,
    );
  }

  close(id: string, confirm: boolean): TeamInfo {
    const row = this.row(id);
    if (row.state === "closed") return this.get(id);
    if (!confirm) throw invalid(`encerrar o time ${row.name} pede confirm: true`);
    const before = this.get(id);
    this.save(id, { state: "closed", paused_by: null });
    this.notify(before, `O time "${row.name}" foi encerrado: não há mais tarefas para este time.`);
    return this.changed(id);
  }

  /** A message from Flightdeck to every member ("mandar a todos"). */
  message(id: string, text: string): { delivered: number; refused: number } {
    this.open(id);
    return this.notify(this.get(id), text);
  }

  /** The member a patch names: by address, session id, card id or name. */
  private find(info: TeamInfo, who: string): TeamMember {
    const found = info.members.find(
      (m) => m.address === who || m.sessionId === who || m.cardId === who || m.name === who,
    );
    if (!found) throw notFound(`o time não tem o membro ${who}`);
    return found;
  }

  async update(patch: TeamPatch): Promise<TeamInfo> {
    const row = this.open(patch.team);
    let info = this.get(row.id);
    const coordinator = info.members[0];
    const tellCoordinator = (text: string) =>
      this.notify(this.get(row.id), text, (m) => m.role === "coordinator");

    if (patch.goal !== undefined) {
      this.save(row.id, { goal: patch.goal });
      tellCoordinator(`O objetivo do time mudou: ${patch.goal}`);
    }
    if (patch.checks !== undefined) {
      this.save(row.id, { checks: JSON.stringify(patch.checks) });
      tellCoordinator(
        patch.checks.length > 0
          ? `Os comandos de verificação do time mudaram: ${patch.checks.join(", ")}`
          : "Os comandos de verificação do time voltaram a ser os checks do projeto.",
      );
    }
    if (patch.persona) {
      const target = this.find(info, patch.persona.member);
      const persona = this.checkPersona(patch.persona.persona);
      const members = this.stored(this.row(row.id)).map((m) =>
        m.name === target.name ? { ...m, persona } : m,
      );
      this.save(row.id, { members: JSON.stringify(members) });
      if (target.sessionId) this.opts.applyPersona?.(target.sessionId, persona);
    }
    if (patch.addWorkers) {
      const members = this.stored(this.row(row.id));
      const taken = members.flatMap((m) => /executora (\d+)$/.exec(m.name)?.[1] ?? []).map(Number);
      const team = {
        name: row.name,
        goal: this.row(row.id).goal,
        checks: JSON.parse(this.row(row.id).checks) as string[],
        projectId: row.project_id,
      };
      for (let i = 0; i < patch.addWorkers; i++) {
        const number = Math.max(0, ...taken) + 1;
        taken.push(number);
        const added = await this.startWorker(
          team,
          `${label(row.name)} · executora ${number}`,
          null,
          coordinator?.address ?? null,
        );
        members.push(added);
        this.save(row.id, { members: JSON.stringify(members) });
        tellCoordinator(`Entrou uma executora no time: "${added.name}" (card ${added.cardId}).`);
      }
    }
    if (patch.removeMember) {
      info = this.get(row.id);
      const target = this.find(info, patch.removeMember);
      if (target.role === "coordinator") {
        throw invalid("a coordenadora não sai do time: encerre o time");
      }
      const members = this.stored(this.row(row.id)).filter((m) => m.name !== target.name);
      this.save(row.id, { members: JSON.stringify(members) });
      if (target.sessionId) {
        this.opts.messaging.notice(
          target.sessionId,
          "system",
          `Você saiu do time "${row.name}": não receba mais tarefas dele.`,
          row.id,
        );
      }
      tellCoordinator(`A executora "${target.name}" saiu do time.`);
    }
    return this.changed(row.id);
  }

  // --- the quota ---

  /** Crossing the limit pauses the active teams; coming back resumes only those the quota paused. */
  private onQuota(): void {
    const blocked = this.opts.quota?.blocked() != null;
    if (blocked === this.blocked) return;
    this.blocked = blocked;
    const rows = this.opts.db.query("SELECT id, state, paused_by FROM teams").all() as Array<
      Pick<Row, "id" | "state" | "paused_by">
    >;
    for (const row of rows) {
      if (blocked && row.state === "active") this.pause(row.id, "quota");
      if (!blocked && row.state === "paused" && row.paused_by === "quota") {
        this.resume(row.id, "quota");
      }
    }
  }
}
