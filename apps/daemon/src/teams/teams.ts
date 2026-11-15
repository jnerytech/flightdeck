/**
 * Phase 21: teams. A coordinator session and workers with cards of their own, started together
 * with the instructions of coordination, paused by the plan quota and resumed with it.
 */

import {
  inSequence,
  type PermissionMode,
  type SessionTeam,
  type TeamInfo,
  type TeamMember,
  type TeamStatus,
  type TeamsUpdatedFrame,
} from "@flightdeck/protocol";
import { parseJsonOr, ulid } from "../kernel/index.ts";
import { MANAGED_STATE } from "../messaging/index.ts";
import { TeamStore } from "./adapters/team-store.ts";
import type { NewTeam, TeamPatch } from "./domain/input.ts";
import {
  checksChanged,
  goalChanged,
  INSTRUCTIONS_VERSION,
  PAUSED_BY_QUOTA,
  RESUME_QUOTA,
  RESUME_USER,
  RESUMED_BY_QUOTA,
  STOP_QUOTA,
  STOP_USER,
  teamClosed,
  workerJoined,
  workerLeft,
  youLeft,
} from "./domain/instructions.ts";
import {
  memberUnknown,
  personaUnknown,
  refuseBlockedQuota,
  refuseBypass,
  refuseClosed,
  refuseDeleteLive,
  refuseDeleteOpen,
  refuseDroppingCoordinator,
  refuseForeign,
  refuseFull,
  refuseNotCoordinator,
  refusePaused,
  refuseUnconfirmedClose,
  teamNotFound,
} from "./domain/refusals.ts";
import { PerKeyQueue } from "./domain/serial.ts";
import { STORED_CHECKS, STORED_MEMBERS, type StoredMember, type TeamRow } from "./domain/stored.ts";
import { toInfo, toMember, toStatus } from "./domain/team-view.ts";
import { label, MAX_WORKERS, NO_SPEC, numberOf, type WorkerSpec } from "./domain/worker.ts";
import { Launch } from "./launch.ts";
import type { TeamsOptions } from "./options.ts";

/** The persona of phase 20's pack a coordinator opens in by default. */
const COORDINATOR_PERSONA = "coordenador";

export class Teams {
  private readonly listeners = new Set<(frame: TeamsUpdatedFrame) => void>();
  private readonly unsubscribe: Array<() => void> = [];
  /** A team's member changes run one at a time (#2090). */
  private readonly changes = new PerKeyQueue();
  private readonly launch: Launch;
  private readonly store: TeamStore;
  private blocked: boolean;

  constructor(private readonly opts: TeamsOptions) {
    this.launch = new Launch(opts);
    this.store = new TeamStore(opts.db);
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
    const row = this.store.get(id);
    if (!row) throw teamNotFound(id);
    return row;
  }

  /**
   * Refuses a team that asks for a mode without permission prompts on a host that forbids it, before
   * anything starts: the coordinator would otherwise be up when the first worker is turned away.
   */
  private checkPermissions(modes: ReadonlyArray<PermissionMode | null | undefined>): void {
    refuseBypass(modes, () => this.opts.bypassAllowed?.() === true);
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
    return toMember(stored, this.opts.host, { sessionId, state });
  }

  private info(row: TeamRow): TeamInfo {
    return toInfo(
      row,
      this.stored(row).map((m) => this.member(m)),
      parseJsonOr(STORED_CHECKS, row.checks, []),
    );
  }

  list(projectId?: string): TeamInfo[] {
    return this.store.list(projectId ?? null).map((row) => this.info(row));
  }

  get(id: string): TeamInfo {
    return this.info(this.row(id));
  }

  /** The team a session belongs to (as coordinator or worker), if it is still running. */
  teamOf(sessionId: string): string | null {
    for (const row of this.store.notClosed()) {
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
    refuseNotCoordinator(row, coordinator, asker, "report");
    this.store.report(id, text, this.now(), done);
    // Told once: a final report repeated (a retry, a second word) does not notify again.
    const news = done && row.report_done !== 1;
    this.changed(id, null, news ? "report_done" : undefined);
    return this.status(id);
  }

  /** Only the team's coordinator may manage its members: the host checks, not the prompt (#2090). */
  private coordinatorOnly(row: TeamRow, asker: string): void {
    const coordinator = this.info(row).members.find((m) => m.role === "coordinator")?.sessionId;
    refuseNotCoordinator(row, coordinator, asker, "manage");
  }

  private refuseOverQuota(later: string): void {
    refuseBlockedQuota(this.opts.quota?.blocked(), later);
  }

  /** The state of a team; with `asker`, only a member of the team may read it. */
  status(id: string, asker?: string): TeamStatus {
    const team = this.get(id);
    refuseForeign(team, asker);
    const listed = this.opts.messaging.list({ team: id, days: 365, limit: 1000 });
    return toStatus(team, this.row(id), listed);
  }

  // --- creating ---

  private async checkPersona(id: string | null | undefined): Promise<string | null> {
    if (id === null || id === undefined) return null;
    const found = await this.opts.personas?.resolve(id);
    if (!found) throw personaUnknown(id);
    return found.id;
  }

  /**
   * The team a worker's card works in, its role and number (issue #101): known before the card
   * starts, so its session is named with it from the first moment, and read from the stored teams
   * after a restart.
   */
  teamOfCard(cardId: string): SessionTeam | null {
    const known = this.launch.cardTeam(cardId);
    if (known) return known;
    for (const row of this.store.all()) {
      const member = this.stored(row).find((m) => m.cardId === cardId);
      if (member) return { name: label(row.name), role: member.role, number: numberOf(member) };
    }
    return null;
  }

  /** The persona a worker's card was started with; the standard name reads it. */
  personaOfCard(cardId: string): string | null {
    return this.launch.cardPersona(cardId);
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
    const coordinatorPermission = input.coordinatorPermission ?? null;
    // Only the modes of workers the team has: a longer list is not used, so it is not refused either.
    this.checkPermissions([
      coordinatorPermission,
      ...(input.workerPermissions ?? []).slice(0, input.workers),
    ]);
    const name = input.name ?? input.goal.slice(0, 40);
    const checks = input.checks ?? [];
    const id = ulid((this.opts.clock ?? Date.now)());
    const { sessionId, members } = await this.launch.start(
      input,
      { name, checks, projectId: project.id, projectPath: project.path },
      { coordinator: coordinatorPersona, workers: workerPersonas },
    );
    this.store.insert({
      id,
      name,
      projectId: project.id,
      goal: input.goal,
      coordinator: sessionId,
      members: JSON.stringify(members),
      checks: JSON.stringify(checks),
      instructionsVersion: INSTRUCTIONS_VERSION,
      createdAt: this.now(),
    });
    return this.changed(id);
  }

  // --- changing ---

  private open(id: string): TeamRow {
    const row = this.row(id);
    refuseClosed(row);
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
    this.store.update(id, { state: "paused", paused_by: by });
    const info = this.get(id);
    this.notify(info, by === "quota" ? STOP_QUOTA : STOP_USER);
    return this.changed(id, by === "quota" ? PAUSED_BY_QUOTA : null);
  }

  resume(id: string, by: "user" | "quota" = "user"): TeamInfo {
    const row = this.open(id);
    if (row.state === "active") return this.get(id);
    this.store.update(id, { state: "active", paused_by: null });
    this.notify(this.get(id), by === "quota" ? RESUME_QUOTA : RESUME_USER);
    return this.changed(id, by === "quota" ? RESUMED_BY_QUOTA : null);
  }

  close(id: string, confirm: boolean): TeamInfo {
    const row = this.row(id);
    if (row.state === "closed") return this.get(id);
    refuseUnconfirmedClose(row, confirm);
    const before = this.get(id);
    this.store.update(id, { state: "closed", paused_by: null });
    this.notify(before, teamClosed(row.name));
    return this.changed(id);
  }

  /**
   * Deletes a closed team (issue #934): its record goes, its members' sessions leave it, and every
   * watcher hears. The sessions, their history and the members' cards stay as they are. A member at
   * work (running, or waiting for an answer) holds it back; one that rests does not.
   */
  delete(id: string): TeamInfo {
    const row = this.row(id);
    refuseDeleteOpen(row);
    const info = this.get(id);
    refuseDeleteLive(row, info);
    this.store.delete(id);
    for (const member of info.members) {
      if (member.sessionId) this.opts.names?.clearTeam?.(member.sessionId);
      if (member.cardId) this.launch.forgetCardTeam(member.cardId);
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
    if (!found) throw memberUnknown(who);
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
    this.store.update(row.id, { members: JSON.stringify(members) });
    if (!target.sessionId) return;
    this.opts.applyPersona?.(target.sessionId, persona);
    // A worker's name may still be waiting for its folder's project key: it is born with the
    // card's persona, which is kept up to date here.
    if (target.cardId) this.launch.setCardPersona(target.cardId, persona);
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
        await /* NOSONAR: workers start one at a time: each takes its own worktree and a free slot */ this.launch.startWorker(
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
      this.store.update(row.id, { members: JSON.stringify(members) });
      tellCoordinator(workerJoined(added.name, added.cardId, spec));
    }
    return started;
  }

  /** Stops a worker, takes it out of the team and tells it so; the coordinator stays. */
  private async dropMember(row: TeamRow, who: string, tellCoordinator: (text: string) => void) {
    const target = this.find(this.get(row.id), who);
    if (target.role === "coordinator") refuseDroppingCoordinator();
    // Its turn is interrupted; the card stays on the board.
    if (target.cardId) await this.opts.board.stopCard(target.cardId);
    const members = this.stored(this.row(row.id)).filter((m) => m.name !== target.name);
    this.store.update(row.id, { members: JSON.stringify(members) });
    if (target.sessionId) {
      this.opts.messaging.notice(target.sessionId, "system", youLeft(row.name), row.id);
    }
    tellCoordinator(workerLeft(target.name));
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
    refusePaused(row);
    const persona = await this.checkPersona(spec.persona);
    const workers = this.stored(row).filter((m) => m.role === "worker").length;
    refuseFull(row, workers, MAX_WORKERS);
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
      this.store.update(row.id, { goal: patch.goal });
      tellCoordinator(goalChanged(patch.goal));
    }
    if (patch.checks !== undefined) {
      this.store.update(row.id, { checks: JSON.stringify(patch.checks) });
      tellCoordinator(checksChanged(patch.checks));
    }
    if (patch.persona) await this.changePersona(row, info, patch.persona);
    if (patch.addWorkers || patch.addMember) {
      refusePaused(row);
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
    for (const row of this.store.states()) {
      if (blocked && row.state === "active") this.pause(row.id, "quota");
      if (!blocked && row.state === "paused" && row.paused_by === "quota") {
        this.resume(row.id, "quota");
      }
    }
  }
}
