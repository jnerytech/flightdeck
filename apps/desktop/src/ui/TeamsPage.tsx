import type { TeamInfo, TeamMember, TeamStatus } from "@flightdeck/protocol";
import { UsersRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Field, NativeSelect } from "@/components/layout/form";
import { Page } from "@/components/layout/page";
import { EmptyState } from "@/components/layout/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AppState, AppStore } from "../lib/app-store.ts";
import { hasFeature } from "../lib/version.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

const SELECT =
  "h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The form of a new team: the goal, the project, the workers and the coordinator's persona. */
function NewTeam(props: { store: AppStore; hostId: string; onCreated(): void; onCancel(): void }) {
  const { store, hostId } = props;
  const { t } = store.i18n;
  const projects = store.getState().projects[hostId] ?? [];
  const [goal, setGoal] = useState("");
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [workers, setWorkers] = useState("2");
  const [persona, setPersona] = useState("");
  /** The workers' personas, comma-separated, in the workers' order. */
  const [workerPersonas, setWorkerPersonas] = useState("");
  const create = async () => {
    const personas = workerPersonas
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const count = Number.parseInt(workers, 10);
    const team = await store.hostCommand(hostId, "teams.create", {
      projectId: projectId || (projects[0]?.id ?? ""),
      goal,
      ...(name.trim() ? { name: name.trim() } : {}),
      workers: Number.isInteger(count) && count > 0 ? count : 1,
      ...(persona.trim() ? { coordinatorPersona: persona.trim() } : {}),
      ...(personas.length > 0 ? { workerPersonas: personas } : {}),
    });
    if (team) props.onCreated();
  };
  return (
    <div className="mb-4 flex max-w-xl flex-col gap-3 rounded-lg border p-4 text-sm">
      <Field label={t("teamsUi.goal")}>
        {(control) => (
          <Textarea {...control} value={goal} onChange={(e) => setGoal(e.target.value)} />
        )}
      </Field>
      <Field label={t("teamsUi.name")}>
        {(control) => <Input {...control} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field label={t("teamsUi.project")}>
        {(control) => (
          <NativeSelect
            {...control}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field label={t("teamsUi.workers")}>
        {(control) => (
          <Input
            {...control}
            type="number"
            value={workers}
            onChange={(e) => setWorkers(e.target.value)}
          />
        )}
      </Field>
      <Field label={t("teamsUi.coordinatorPersona")}>
        {(control) => (
          <Input {...control} value={persona} onChange={(e) => setPersona(e.target.value)} />
        )}
      </Field>
      <Field label={t("teamsUi.workerPersonas")}>
        {(control) => (
          <Input
            {...control}
            value={workerPersonas}
            onChange={(e) => setWorkerPersonas(e.target.value)}
          />
        )}
      </Field>
      <div className="flex gap-2">
        <ActionButton
          disabled={!goal.trim()}
          disabledReason={t("teamsUi.goalNeeded")}
          onClick={() => create()}
        >
          {t("teamsUi.create")}
        </ActionButton>
        <Button variant="ghost" onClick={props.onCancel}>
          {t("teamsUi.cancel")}
        </Button>
      </div>
    </div>
  );
}

/** One member: its role, persona, state, card and last report, and the persona to switch to. */
function Member(props: {
  store: AppStore;
  member: TeamMember;
  report: { text: string; at: string } | null;
  open: boolean;
  onPersona(persona: string): void;
  onRemove(): void;
}) {
  const { store, member } = props;
  const { t } = store.i18n;
  const [persona, setPersona] = useState(member.persona ?? "");
  return (
    <li className="flex flex-col gap-1 rounded-md border p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{member.name}</strong>
        <Badge variant="outline">
          {t(member.role === "coordinator" ? "teamsUi.coordinator" : "teamsUi.worker")}
        </Badge>
        {member.persona && <Badge variant="outline">{member.persona}</Badge>}
        {member.sessionState && (
          <span className="text-muted-foreground">
            {t(`teamsUi.sessionStates.${member.sessionState}`)}
          </span>
        )}
        {member.cardId && <span className="font-mono text-muted-foreground">{member.cardId}</span>}
      </div>
      {props.report && (
        <p className="text-muted-foreground">
          {t("teamsUi.lastReport")}: {props.report.text}
        </p>
      )}
      {props.open && (
        <div className="flex flex-wrap items-center gap-1">
          <Input
            aria-label={t("teamsUi.persona", { name: member.name })}
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            className="h-7 w-40"
          />
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("teamsUi.setPersona", { name: member.name })}
            onClick={() => props.onPersona(persona)}
          >
            {t("teamsUi.setPersonaButton")}
          </Button>
          {member.role === "worker" && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("teamsUi.remove", { name: member.name })}
              onClick={props.onRemove}
            >
              {t("teamsUi.removeButton")}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/** One team with its members and its controls. */
function Team(props: {
  store: AppStore;
  hostId: string;
  team: TeamInfo;
  status: TeamStatus | null;
  onChanged(team: TeamInfo): void;
}) {
  const { store, hostId, team } = props;
  const { t } = store.i18n;
  const [text, setText] = useState("");
  const [sent, setSent] = useState<{ delivered: number; refused: number } | null>(null);
  const [confirm, setConfirm] = useState<
    { kind: "close" } | { kind: "remove"; member: string } | null
  >(null);
  const open = team.state !== "closed";
  const act = async (command: Promise<TeamInfo | null>) => {
    const updated = await command;
    if (updated) props.onChanged(updated);
  };
  const reportOf = (name: string) =>
    props.status?.members.find((m) => m.name === name)?.lastReport ?? null;
  return (
    <li
      aria-label={t("teamsUi.row", { name: team.name })}
      className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong>{team.name}</strong>
        <Badge variant="outline">{t(`teamsUi.states.${team.state}`)}</Badge>
        {team.pausedBy === "quota" && (
          <span className="text-status-needs-you text-xs">{t("teamsUi.pausedByQuota")}</span>
        )}
      </div>
      <p className="text-muted-foreground whitespace-pre-wrap">{team.goal}</p>
      <ul className="flex flex-col gap-1">
        {team.members.map((member) => (
          <Member
            key={member.name}
            store={store}
            member={member}
            report={reportOf(member.name)}
            open={open}
            onPersona={(persona) =>
              void act(
                store.hostCommand(hostId, "teams.update", {
                  team: team.id,
                  persona: { member: member.name, persona: persona.trim() || null },
                }),
              )
            }
            onRemove={() => setConfirm({ kind: "remove", member: member.name })}
          />
        ))}
      </ul>
      {open && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1">
            {team.state === "active" ? (
              <Button
                variant="outline"
                size="sm"
                aria-label={t("teamsUi.pause", { name: team.name })}
                onClick={() =>
                  void act(store.hostCommand(hostId, "teams.pause", { team: team.id }))
                }
              >
                {t("teamsUi.pauseButton")}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                aria-label={t("teamsUi.resume", { name: team.name })}
                onClick={() =>
                  void act(store.hostCommand(hostId, "teams.resume", { team: team.id }))
                }
              >
                {t("teamsUi.resumeButton")}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              aria-label={t("teamsUi.addWorker", { name: team.name })}
              onClick={() =>
                void act(
                  store.hostCommand(hostId, "teams.update", { team: team.id, addWorkers: 1 }),
                )
              }
            >
              {t("teamsUi.addWorkerButton")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label={t("teamsUi.close", { name: team.name })}
              onClick={() => setConfirm({ kind: "close" })}
            >
              {t("teamsUi.closeButton")}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Input
              aria-label={t("teamsUi.messageAll")}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="h-8 w-64"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!text.trim()}
              onClick={async () => {
                const result = await store.hostCommand(hostId, "teams.message", {
                  team: team.id,
                  text,
                });
                if (result) setSent(result);
              }}
            >
              {t("teamsUi.sendAll")}
            </Button>
            {sent && <span role="status">{t("teamsUi.sentAll", sent)}</span>}
          </div>
        </div>
      )}
      {confirm && (
        <ConfirmDialog
          message={
            confirm.kind === "close"
              ? t("teamsUi.closeMessage", { name: team.name })
              : t("teamsUi.removeMessage", { name: confirm.member })
          }
          confirmLabel={t(
            confirm.kind === "close" ? "teamsUi.closeButton" : "teamsUi.removeButton",
          )}
          destructive
          onConfirm={() => {
            setConfirm(null);
            void act(
              confirm.kind === "close"
                ? store.hostCommand(hostId, "teams.close", { team: team.id, confirm: true })
                : store.hostCommand(hostId, "teams.update", {
                    team: team.id,
                    removeMember: confirm.member,
                  }),
            );
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </li>
  );
}

/** Phase 21: the teams of a host, a new one, and the controls of each. */
export function TeamsPage(props: { store: AppStore; state: AppState }) {
  const { store, state } = props;
  const { t } = store.i18n;
  const hosts = state.hosts.filter(
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "teams", false),
  );
  const [hostId, setHostId] = useState("");
  const host = hosts.find((h) => h.id === hostId) ?? hosts[0];
  const current = host?.id ?? "";
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [statuses, setStatuses] = useState<Record<string, TeamStatus>>({});
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!current) return;
    const list = await store.hostCommand(current, "teams.list", {});
    if (!list) return;
    setTeams(list.teams);
    const next: Record<string, TeamStatus> = {};
    for (const team of list.teams) {
      const status = await store.hostCommand(current, "teams.status", { team: team.id });
      if (status) next[team.id] = status;
    }
    setStatuses(next);
  }, [store, current]);
  useEffect(() => {
    if (current) void store.loadProjects(current);
    void load();
    return store.onTeamsUpdated(() => void load());
  }, [store, current, load]);

  if (!host) {
    return (
      <Page title={t("teamsUi.title")}>
        <EmptyState icon={UsersRound} title={t("teamsUi.noHost")} />
      </Page>
    );
  }
  return (
    <Page
      title={t("teamsUi.title")}
      subtitle={t("teamsUi.subtitle")}
      actions={
        <div className="flex gap-2">
          {hosts.length > 1 && (
            <select
              aria-label={t("teamsUi.host")}
              className={SELECT}
              value={current}
              onChange={(e) => setHostId(e.target.value)}
            >
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          )}
          {!creating && <Button onClick={() => setCreating(true)}>{t("teamsUi.new")}</Button>}
        </div>
      }
    >
      {creating && (
        <NewTeam
          store={store}
          hostId={current}
          onCreated={() => {
            setCreating(false);
            void load();
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      {teams.length === 0 && !creating && (
        <EmptyState
          icon={UsersRound}
          title={t("teamsUi.empty")}
          action={<Button onClick={() => setCreating(true)}>{t("teamsUi.emptyAction")}</Button>}
        />
      )}
      <ul aria-label={t("teamsUi.list")} className="flex max-w-3xl flex-col gap-3">
        {teams.map((team) => (
          <Team
            key={team.id}
            store={store}
            hostId={current}
            team={team}
            status={statuses[team.id] ?? null}
            onChanged={() => void load()}
          />
        ))}
      </ul>
    </Page>
  );
}
