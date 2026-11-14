/**
 * Phase 21: teams. A coordinator session and workers with cards of their own, started together
 * with the instructions of coordination, paused by the plan quota and resumed with it.
 */

import {
  type EffortLevel,
  inSequence,
  type MessageInfo,
  type PermissionMode,
  type SessionTeam,
  type TeamInfo,
  type TeamMember,
  type TeamStatus,
  type TeamsUpdatedFrame,
} from "@flightdeck/protocol";
import { FlightdeckError, parseJsonOr, ulid } from "../kernel/index.ts";
import { MANAGED_STATE } from "../messaging/index.ts";
import { withoutPersonas } from "../personas/index.ts";
import type { NewTeam, TeamPatch } from "./domain/input.ts";
import {
  coordinatorInstructions,
  INSTRUCTIONS_VERSION,
  RESUME_QUOTA,
  RESUME_USER,
  STOP_QUOTA,
  STOP_USER,
  type TeamBrief,
  withCoordinatorBrief,
  workerInstructions,
} from "./domain/instructions.ts";
import { STORED_CHECKS, STORED_MEMBERS, type StoredMember, type TeamRow } from "./domain/stored.ts";
import {
  MAX_WORKERS,
  NO_SPEC,
  numberOf,
  type WorkerSpec,
  type WorkerStart,
} from "./domain/worker.ts";
import type { TeamsOptions } from "./options.ts";
import { PerKeyQueue } from "./serial.ts";

/** The persona of phase 20's pack a coordinator opens in by default. */
export const COORDINATOR_PERSONA = "coordenador";

/**
 * The name the cards and sessions of a team carry. A card's branch comes from its title cut short,
 * so a long team name would give every worker the same branch: it is cut before the number.
 */
const label = (name: string): string => name.slice(0, 24).trimEnd();

const bad = (message: string, reason?: string, params?: Record<string, string | number>) =>
  new FlightdeckError("bad_request", message, reason, params);
const invalid = (message: string, reason?: string, params?: Record<string, string | number>) =>
  new FlightdeckError("invalid_state", message, reason, params);
const notFound = (message: string, reason?: string, params?: Record<string, string | number>) =>
  new FlightdeckError("not_found", message, reason, params);

export class Teams {
  private readonly listeners = new Set<(frame: TeamsUpdatedFrame) => void>();
  private readonly unsubscribe: Array<() => void> = [];
  /** The persona each worker card was started with, for the standard names. */
  private readonly cardPersonas = new Map<string, string>();
  /** The team, role and number each worker card was started with (issue #101). */
  private readonly cardTeams = new Map<string, SessionTeam>();
  /** A team's member changes run one at a time (#2090). */
  private readonly changes = new PerKeyQueue();
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

  private row(id: string): TeamRow {
    const row = this.opts.db.query("SELECT * FROM teams WHERE id = ?").get(id) as TeamRow | null;
    if (!row) throw notFound(`team ${id} does not exist`, "team_not_found", { id });
    return row;
  }

  /**
   * Refuses a team that asks for a mode without permission prompts on a host that forbids it, before
   * anything starts: the coordinator would otherwise be up when the first worker is turned away.
   */
  private checkPermissions(modes: ReadonlyArray<PermissionMode | null | undefined>): void {
    if (!modes.includes("bypassPermissions") || this.opts.bypassAllowed?.() === true) return;
    throw new FlightdeckError(
      "invalid_permission_update",
      "this host does not allow sessions without permission prompts",
      "bypass_not_allowed",
    );
  }

  private stored(row: TeamRow): StoredMember[] {
    return parseJsonOr(STORED_MEMBERS, row.members, []);
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
      model: stored.model ?? null,
      permission: stored.permission ?? null,
      cardId: stored.cardId,
      sessionId,
      address: sessionId ? `${this.opts.host}/${sessionId}` : null,
      sessionState: state,
      number: numberOf(stored),
    };
  }

  private info(row: TeamRow): TeamInfo {
    return {
      id: row.id,
      name: row.name,
      projectId: row.project_id,
      goal: row.goal,
      coordinator: row.coordinator,
      members: this.stored(row).map((m) => this.member(m)),
      checks: parseJsonOr(STORED_CHECKS, row.checks, []),
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
      .all(projectId ?? null) as TeamRow[];
    return rows.map((row) => this.info(row));
  }

  get(id: string): TeamInfo {
    return this.info(this.row(id));
  }

  /** The team a session belongs to (as coordinator or worker), if it is still running. */
  teamOf(sessionId: string): string | null {
    const rows = this.opts.db
      .query("SELECT * FROM teams WHERE state <> 'closed'")
      .all() as TeamRow[];
    for (const row of rows) {
      if (this.info(row).members.some((m) => m.sessionId === sessionId)) return row.id;
    }
    return null;
  }

  /**
   * #1220: the coordinator's report, the team's outcome; `done` says the goal is met and tells the
   * watchers. Only the team's coordinator may write it: the host checks, not the prompt.
   */
  report(id: string, asker: string, text: string, done: boolean): TeamStatus {
    const row = this.open(id);
    const coordinator = this.info(row).members.find((m) => m.role === "coordinator")?.sessionId;
    if (!coordinator || asker !== coordinator) {
      throw invalid(
        `only the coordinator of team ${row.name} reports its outcome`,
        "team_report_not_coordinator",
        { team: row.name },
      );
    }
    this.opts.db
      .query("UPDATE teams SET report_text = ?, report_at = ?, report_done = ? WHERE id = ?")
      .run(text, this.now(), done ? 1 : 0, id);
    // Told once: a final report repeated (a retry, a second word) does not notify again.
    const news = done && row.report_done !== 1;
    this.changed(id, null, news ? "report_done" : undefined);
    return this.status(id);
  }

  /** Only the team's coordinator may manage its members: the host checks, not the prompt (#2090). */
  private coordinatorOnly(row: TeamRow, asker: string): void {
    const coordinator = this.info(row).members.find((m) => m.role === "coordinator")?.sessionId;
    if (!coordinator || asker !== coordinator) {
      throw invalid(
        `only the coordinator of team ${row.name} adds or removes its members`,
        "team_manage_not_coordinator",
        { team: row.name },
      );
    }
  }

  private refusePaused(row: TeamRow): void {
    if (row.state === "paused") {
      throw invalid(`team ${row.name} is paused: resume it before adding`, "team_paused", {
        name: row.name,
      });
    }
  }

  /** Refuses, never queues, while the plan quota is over its limit. */
  private refuseOverQuota(later: string): void {
    const blocked = this.opts.quota?.blocked();
    if (!blocked) return;
    const until = blocked.until ? new Date(blocked.until).toISOString() : "the next reset";
    const message = `the plan quota is over the limit until ${until}: ${later}`;
    throw blocked.until
      ? invalid(message, "team_quota_until", { until })
      : invalid(message, "team_quota_over");
  }

  /** The state of a team; with `asker`, only a member of the team may read it. */
  status(id: string, asker?: string): TeamStatus {
    const team = this.get(id);
    if (asker !== undefined && !team.members.some((m) => m.sessionId === asker)) {
      throw invalid(`this session is not in team ${team.name}`, "team_session_foreign", {
        team: team.name,
      });
    }
    const messages = this.opts.messaging
      .list({ team: id, days: 365, limit: 1000 })
      .filter((m) => m.kind === "session");
    const last = (member: TeamMember): MessageInfo | undefined =>
      messages.find((m) => m.fromSession === member.sessionId);
    const row = this.row(id);
    return {
      team,
      messages: messages.length,
      outcome:
        row.report_text && row.report_at
          ? { text: row.report_text, at: row.report_at, done: row.report_done === 1 }
          : null,
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

  private async checkPersona(id: string | null | undefined): Promise<string | null> {
    if (id === null || id === undefined) return null;
    const found = await this.opts.personas?.resolve(id);
    if (!found) throw bad(`persona ${id} does not exist`, "persona_unknown", { persona: id });
    return found.id;
  }

  /**
   * The team a worker's card works in, its role and number (issue #101): known before the card
   * starts, so its session is named with it from the first moment, and read from the stored teams
   * after a restart.
   */
  teamOfCard(cardId: string): SessionTeam | null {
    const known = this.cardTeams.get(cardId);
    if (known) return known;
    const rows = this.opts.db.query("SELECT * FROM teams").all() as TeamRow[];
    for (const row of rows) {
      const member = this.stored(row).find((m) => m.cardId === cardId);
      if (member) return { name: label(row.name), role: member.role, number: numberOf(member) };
    }
    return null;
  }

  /** The persona a worker's card was started with; the standard name reads it. */
  personaOfCard(cardId: string): string | null {
    return this.cardPersonas.get(cardId) ?? null;
  }

  /** Creates a worker's card with its instructions and starts it (the quota queue still applies). */
  private async startWorker(
    team: { name: string; goal: string; checks: string[]; projectId: string },
    worker: WorkerStart,
  ): Promise<StoredMember> {
    const { name, persona, coordinator, model, number, permission, effort, brief: told } = worker;
    const brief: TeamBrief = { ...team, workers: [] };
    const card = this.opts.board.createCard(team.projectId, {
      title: name,
      description: withCoordinatorBrief(workerInstructions(brief, coordinator), told),
      // The card's variant is where a card keeps the model, the effort and the mode its session opens in.
      ...(model || effort || permission
        ? { variant: { label: "team", model, effort, persona, permissionMode: permission } }
        : {}),
    });
    // Before the card starts: its session is named with this persona from the first moment.
    if (persona) this.cardPersonas.set(card.id, persona);
    this.cardTeams.set(card.id, { name: label(team.name), role: "worker", number });
    await (this.opts.startWorker
      ? this.opts.startWorker(card.id, persona, model)
      : this.opts.board.startCard(card.id));
    return {
      name,
      role: "worker",
      persona,
      model,
      permission,
      cardId: card.id,
      sessionId: null,
      number,
    };
  }

  async create(input: NewTeam): Promise<TeamInfo> {
    const project = this.opts.board.getProject(input.projectId);
    this.refuseOverQuota("create the team later, or it starts paused");
    // The spec's coordinator is the pack's `coordenador` (phase 20) when none is asked for.
    const coordinatorPersona = await this.checkPersona(
      input.coordinatorPersona ??
        ((await this.opts.personas?.resolve(COORDINATOR_PERSONA))
          ? COORDINATOR_PERSONA
          : undefined),
    );
    const workerPersonas: Array<string | null> = [];
    await inSequence(input.workerPersonas ?? [], async (p) => {
      workerPersonas.push(await this.checkPersona(p));
    });
    const coordinatorModel = input.coordinatorModel ?? null;
    const coordinatorEffort = input.coordinatorEffort ?? null;
    const coordinatorPermission = input.coordinatorPermission ?? null;
    // Only the modes of workers the team has: a longer list is not used, so it is not refused either.
    this.checkPermissions([
      coordinatorPermission,
      ...(input.workerPermissions ?? []).slice(0, input.workers),
    ]);
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
      (async (start: {
        cwd: string;
        prompt: string;
        name: string;
        model: string | null;
        effort: EffortLevel | null;
        permissionMode: PermissionMode | null;
      }) =>
        this.opts.manager.create(
          {
            cwd: start.cwd,
            prompt: start.prompt,
            name: start.name,
            ...(start.model ? { model: start.model } : {}),
            ...(start.effort ? { effort: start.effort } : {}),
            ...(start.permissionMode ? { permissionMode: start.permissionMode } : {}),
          },
          { prepared: await (this.opts.preparePersonas ?? withoutPersonas)(undefined, start.cwd) },
        ));
    const coordinatorName = `${label(name)} · coordenadora`;
    // The session is named as it starts, and its persona is set on that name right below.
    await this.opts.warm?.(project.path);
    const { sessionId } = await startCoordinator({
      cwd: project.path,
      prompt,
      name: coordinatorName,
      persona: coordinatorPersona,
      model: coordinatorModel,
      effort: coordinatorEffort,
      permissionMode: coordinatorPermission,
    });
    if (coordinatorPersona) this.opts.names?.setPersona(sessionId, coordinatorPersona);
    this.opts.names?.setTeam?.(sessionId, { name: label(name), role: "coordinator", number: null });
    const address = `${this.opts.host}/${sessionId}`;
    const members: StoredMember[] = [
      {
        name: coordinatorName,
        role: "coordinator",
        persona: coordinatorPersona,
        model: coordinatorModel,
        permission: coordinatorPermission,
        cardId: null,
        sessionId,
      },
    ];
    await inSequence(workerNames.entries(), async ([i, workerName]) => {
      members.push(
        await this.startWorker(team, {
          name: workerName,
          persona: workerPersonas[i] ?? null,
          coordinator: address,
          model: input.workerModels?.[i] ?? null,
          number: i + 1,
          permission: input.workerPermissions?.[i] ?? null,
          effort: input.workerEfforts?.[i] ?? null,
        }),
      );
    });
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

  private open(id: string): TeamRow {
    const row = this.row(id);
    if (row.state === "closed") {
      throw invalid(`team ${row.name} is closed`, "team_closed", { name: row.name });
    }
    return row;
  }

  private changed(
    id: string,
    reason: string | null = null,
    event?: TeamsUpdatedFrame["event"],
  ): TeamInfo {
    const info = this.get(id);
    const frame = {
      type: "teams.updated" as const,
      team: info,
      reason,
      ...(event ? { event } : {}),
    };
    for (const listener of this.listeners) listener(frame);
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
    if (!confirm) {
      throw invalid(`closing team ${row.name} needs confirm: true`, "team_close_confirm", {
        name: row.name,
      });
    }
    const before = this.get(id);
    this.save(id, { state: "closed", paused_by: null });
    this.notify(before, `O time "${row.name}" foi encerrado: não há mais tarefas para este time.`);
    return this.changed(id);
  }

  /**
   * Deletes a closed team (issue #934): its record goes, its members' sessions leave it, and every
   * watcher hears. The sessions, their history and the members' cards stay as they are. A member at
   * work (running, or waiting for an answer) holds it back; one that rests does not.
   */
  delete(id: string): TeamInfo {
    const row = this.row(id);
    if (row.state !== "closed") {
      throw invalid(`team ${row.name} is still open: close it first`, "team_delete_open", {
        name: row.name,
      });
    }
    const info = this.get(id);
    const working = info.members.filter(
      (m) => m.sessionState === "running" || m.sessionState === "waiting",
    );
    if (working.length > 0) {
      throw invalid(`team ${row.name} has members at work`, "team_delete_live", {
        name: row.name,
        members: working.length,
      });
    }
    this.opts.db.query("DELETE FROM teams WHERE id = ?").run(id);
    for (const member of info.members) {
      if (member.sessionId) this.opts.names?.clearTeam?.(member.sessionId);
      if (member.cardId) this.cardTeams.delete(member.cardId);
    }
    for (const listener of this.listeners)
      listener({ type: "teams.updated", team: info, reason: null });
    return info;
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
    if (!found)
      throw notFound(`the team has no member ${who}`, "team_member_unknown", { member: who });
    return found;
  }

  /** Gives a member another persona: stored, applied to its open session and to its name. */
  private async changePersona(
    row: TeamRow,
    info: TeamInfo,
    change: { member: string; persona: string | null },
  ) {
    const target = this.find(info, change.member);
    const persona = await this.checkPersona(change.persona);
    const members = this.stored(this.row(row.id)).map((m) =>
      m.name === target.name ? { ...m, persona } : m,
    );
    this.save(row.id, { members: JSON.stringify(members) });
    if (!target.sessionId) return;
    this.opts.applyPersona?.(target.sessionId, persona);
    // A worker's name may still be waiting for its folder's project key: it is born with the
    // card's persona, which is kept up to date here.
    if (target.cardId) {
      if (persona) this.cardPersonas.set(target.cardId, persona);
      else this.cardPersonas.delete(target.cardId);
    }
    if (this.opts.names?.get(target.sessionId)) {
      this.opts.names.setPersona(target.sessionId, persona);
    }
  }

  /** Starts `count` more workers, numbered after the ones the team has, one at a time. */
  private async addWorkers(
    row: TeamRow,
    count: number,
    coordinator: TeamMember | undefined,
    tellCoordinator: (text: string) => void,
    spec: WorkerSpec = NO_SPEC,
  ): Promise<StoredMember[]> {
    const members = this.stored(this.row(row.id));
    const started: StoredMember[] = [];
    const taken = members.flatMap((m) => numberOf(m) ?? []);
    const team = {
      name: row.name,
      goal: this.row(row.id).goal,
      checks: parseJsonOr(STORED_CHECKS, this.row(row.id).checks, []),
      projectId: row.project_id,
    };
    for (let i = 0; i < count; i++) {
      const number = Math.max(0, ...taken) + 1;
      taken.push(number);
      const added =
        await /* NOSONAR: workers start one at a time: each takes its own worktree and a free slot */ this.startWorker(
          team,
          {
            ...spec,
            name: `${label(row.name)} · executora ${number}`,
            coordinator: coordinator?.address ?? null,
            number,
          },
        );
      members.push(added);
      started.push(added);
      this.save(row.id, { members: JSON.stringify(members) });
      const asked = [
        spec.persona && `persona ${spec.persona}`,
        spec.model && `modelo ${spec.model}`,
        spec.effort && `effort ${spec.effort}`,
        spec.permission && `modo de permissão ${spec.permission}`,
      ].filter(Boolean);
      tellCoordinator(
        `Entrou uma executora no time: "${added.name}" (card ${added.cardId})${
          asked.length > 0 ? `, com ${asked.join(" e ")}` : ""
        }.`,
      );
    }
    return started;
  }

  /** Stops a worker, takes it out of the team and tells it so; the coordinator stays. */
  private async dropMember(row: TeamRow, who: string, tellCoordinator: (text: string) => void) {
    const target = this.find(this.get(row.id), who);
    if (target.role === "coordinator") {
      throw invalid(
        "the coordinator does not leave the team: close the team",
        "team_coordinator_stays",
      );
    }
    // Its turn is interrupted; the card stays on the board.
    if (target.cardId) await this.opts.board.stopCard(target.cardId);
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

  /**
   * #2090: the coordinator adds a worker in a persona it picks, with a brief for its card. The host
   * checks who asks, the pause, the quota, the persona and the size before anything starts.
   */
  async addMember(
    id: string,
    asker: string,
    spec: { persona?: string; model?: string; brief: string },
  ): Promise<{ member: TeamMember; team: TeamInfo }> {
    return this.changes.run(id, () => this.doAddMember(id, asker, spec));
  }

  private async doAddMember(
    id: string,
    asker: string,
    spec: { persona?: string; model?: string; brief: string },
  ): Promise<{ member: TeamMember; team: TeamInfo }> {
    const row = this.open(id);
    this.coordinatorOnly(row, asker);
    // The quota first: it pauses every active team, so a paused team in that window is the quota's.
    this.refuseOverQuota("add the member later");
    this.refusePaused(row);
    const persona = await this.checkPersona(spec.persona);
    const workers = this.stored(row).filter((m) => m.role === "worker").length;
    if (workers >= MAX_WORKERS) {
      throw invalid(`team ${row.name} already has ${workers} workers`, "team_full", {
        name: row.name,
        workers,
      });
    }
    const [added] = await this.addWorkers(
      row,
      1,
      this.info(row).members[0],
      (text) => this.notify(this.get(row.id), text, (m) => m.role === "coordinator"),
      { persona, model: spec.model ?? null, effort: null, permission: null, brief: spec.brief },
    );
    const team = this.changed(row.id);
    return { member: team.members.find((m) => m.name === added?.name) as TeamMember, team };
  }

  /** #2090: the coordinator takes a worker out; its card and branch stay, and its turn is interrupted. */
  removeMember(id: string, asker: string, member: string): Promise<TeamInfo> {
    return this.changes.run(id, async () => {
      const row = this.open(id);
      this.coordinatorOnly(row, asker);
      await this.dropMember(row, member, (text) =>
        this.notify(this.get(row.id), text, (m) => m.role === "coordinator"),
      );
      return this.changed(row.id);
    });
  }

  update(patch: TeamPatch): Promise<TeamInfo> {
    return this.changes.run(patch.team, () => this.doUpdate(patch));
  }

  private async doUpdate(patch: TeamPatch): Promise<TeamInfo> {
    const row = this.open(patch.team);
    const info = this.get(row.id);
    const coordinator = info.members[0];
    const tellCoordinator = (text: string) =>
      this.notify(this.get(row.id), text, (m) => m.role === "coordinator");

    // Before anything changes: a refused worker leaves the team as it was.
    if (patch.addMember) this.checkPermissions([patch.addMember.permission]);
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
    if (patch.persona) await this.changePersona(row, info, patch.persona);
    if (patch.addWorkers || patch.addMember) {
      this.refusePaused(row);
    }
    if (patch.addWorkers)
      await this.addWorkers(row, patch.addWorkers, coordinator, tellCoordinator);
    if (patch.addMember) {
      const spec = {
        persona: await this.checkPersona(patch.addMember.persona),
        model: patch.addMember.model ?? null,
        effort: patch.addMember.effort ?? null,
        permission: patch.addMember.permission ?? null,
      };
      await this.addWorkers(row, 1, coordinator, tellCoordinator, spec);
    }
    if (patch.removeMember) await this.dropMember(row, patch.removeMember, tellCoordinator);
    return this.changed(row.id);
  }

  // --- the quota ---

  /** Crossing the limit pauses the active teams; coming back resumes only those the quota paused. */
  private onQuota(): void {
    const blocked = this.opts.quota?.blocked() != null;
    if (blocked === this.blocked) return;
    this.blocked = blocked;
    const rows = this.opts.db.query("SELECT id, state, paused_by FROM teams").all() as Array<
      Pick<TeamRow, "id" | "state" | "paused_by">
    >;
    for (const row of rows) {
      if (blocked && row.state === "active") this.pause(row.id, "quota");
      if (!blocked && row.state === "paused" && row.paused_by === "quota") {
        this.resume(row.id, "quota");
      }
    }
  }
}
