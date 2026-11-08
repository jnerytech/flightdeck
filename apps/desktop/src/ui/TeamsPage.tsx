import type { TeamInfo, TeamMember, TeamStatus } from "@flightdeck/protocol";
import { inSequence } from "@flightdeck/protocol";
import { Copy, UsersRound } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AssistField } from "@/components/assistant/assist-field";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Field, FieldRow, FormActions, NativeSelect } from "@/components/layout/form";
import { Page } from "@/components/layout/page";
import { EmptyState } from "@/components/layout/states";
import { ModelSelect } from "@/components/personas/model-select";
import { type PermissionChoice, PermissionSelect } from "@/components/personas/permission-select";
import { PersonaPicker, useSuggestedPersona } from "@/components/personas/persona-picker";
import { AddProject } from "@/components/projects/add-project";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSwitcherHostId } from "@/hooks/use-switcher-hosts";
import { useStoreSlice, useStoreState } from "@/lib/use-store";
import type { AppStore } from "../lib/app-store.ts";
import type { Route } from "../lib/router.ts";
import { sessionLabel } from "../lib/session-label.ts";
import { useDraft } from "../lib/use-draft.ts";
import { hasFeature } from "../lib/version.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

/**
 * Issue #93: what a host takes for a team member's permission mode. A host that does not announce
 * it would ignore the choice, so the form shows none; Bypass needs the host's own switch.
 */
function useModes(store: AppStore, hostId: string) {
  const { hosts } = useStoreSlice(store, MODES_KEYS);
  const host = hosts.find((h) => h.id === hostId);
  return {
    offered: hasFeature(host?.hostInfo?.features, "teams.permissions", false),
    allowBypass: host?.hostInfo?.allowBypassPermissions === true,
    name: host?.name ?? hostId,
  };
}
const MODES_KEYS = ["hosts"] as const;

/** A choice the host no longer offers (Bypass after its switch went off) is the default again. */
const offeredChoice = (value: PermissionChoice, allowBypass: boolean): PermissionChoice =>
  value === "bypassPermissions" && !allowBypass ? "" : value;

/** The form of a new team: the goal, the project, the workers and the coordinator's persona. */
function NewTeam(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    onCreated(): void;
    onCancel(): void;
    onOpenSettings(): void;
  }>,
) {
  const { store, hostId } = props;
  const { t } = store.i18n;
  const state = useStoreState(store);
  const projects = state.projects[hostId] ?? [];
  // The host's projects are asked for when the form opens: "none" is only said once it answered.
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    void store.loadProjects(hostId).finally(() => setAsked(true));
  }, [store, hostId]);
  const [goal, setGoal] = useState("");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState("");
  // The first project until another is chosen; a project just added is chosen at once.
  const projectId = projects.some((p) => p.id === picked) ? picked : (projects[0]?.id ?? "");
  const [persona, setPersona] = useState("");
  const [model, setModel] = useState("");
  const modes = useModes(store, hostId);
  const [permission, setPermission] = useState<PermissionChoice>("");
  /** Bypass asks again each time the team is created. */
  const [asking, setAsking] = useState(false);
  /**
   * One row per worker: the row's persona, model and permission mode ("" is the default). A persona
   * nobody picked is `null` and shows the Developer when the host has it.
   */
  type Row = { persona: string | null; model: string; permission: PermissionChoice };
  const [rows, setRows] = useState<Row[]>([
    { persona: null, model: "", permission: "" },
    { persona: null, model: "", permission: "" },
  ]);
  const setRow = (index: number, change: Partial<Row>) =>
    setRows((all) => all.map((row, i) => (i === index ? { ...row, ...change } : row)));
  const workerDefault = useSuggestedPersona(store, hostId, "dev", true);
  const personaOf = (row: Row) => row.persona ?? workerDefault;
  const [creating, setCreating] = useState(false);
  // A second submit before the first answered would create the team twice.
  const inFlight = useRef(false);
  const create = async (confirmed = false) => {
    if (inFlight.current) return;
    const coordinator = offeredChoice(permission, modes.allowBypass);
    const workers = rows.map((row) => offeredChoice(row.permission, modes.allowBypass));
    const asked = modes.offered ? [coordinator, ...workers] : [];
    if (asked.includes("bypassPermissions") && !confirmed) {
      setAsking(true);
      return;
    }
    setAsking(false);
    inFlight.current = true;
    setCreating(true);
    const team = await store.hostCommand(hostId, "teams.create", {
      projectId,
      goal,
      ...(name.trim() ? { name: name.trim() } : {}),
      workers: rows.length,
      ...(persona ? { coordinatorPersona: persona } : {}),
      ...(rows.some(personaOf) ? { workerPersonas: rows.map(personaOf) } : {}),
      ...(model ? { coordinatorModel: model } : {}),
      ...(rows.some((row) => row.model)
        ? { workerModels: rows.map((row) => row.model || null) }
        : {}),
      ...(modes.offered && coordinator ? { coordinatorPermission: coordinator } : {}),
      ...(modes.offered && workers.some(Boolean)
        ? { workerPermissions: workers.map((mode) => mode || null) }
        : {}),
    });
    inFlight.current = false;
    setCreating(false);
    if (team) props.onCreated();
  };
  return (
    <form
      className="flex max-w-xl flex-col gap-3 rounded-lg border p-4 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <Field label={t("teamsUi.goal")}>
        {(control) => (
          <AssistField
            binding={{
              controller: store.assistant,
              kind: "team.goal",
              fieldHostId: hostId,
              openSettings: props.onOpenSettings,
            }}
            value={goal}
            onChange={setGoal}
            t={t}
          >
            {(assist) => (
              <Textarea
                {...control}
                {...assist}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            )}
          </AssistField>
        )}
      </Field>
      <Field label={t("teamsUi.name")}>
        {(control) => <Input {...control} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      {projects.length === 0 && asked && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-muted-foreground">{t("teamsUi.noProjects")}</p>
          <AddProject store={store} hostId={hostId} onAdded={(added) => setPicked(added.id)} />
        </div>
      )}
      {projects.length > 0 && (
        <Field label={t("teamsUi.project")}>
          {(control) => (
            <NativeSelect
              {...control}
              value={projectId}
              onChange={(e) => setPicked(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      )}
      <PersonaPicker
        store={store}
        hostId={hostId}
        label={t("teamsUi.coordinatorPersona")}
        value={persona}
        onChange={setPersona}
        idsOnly
      />
      <ModelSelect
        label={t("teamsUi.coordinatorModel")}
        defaultLabel={t("teamsUi.modelDefault")}
        value={model}
        onChange={setModel}
      />
      {modes.offered && (
        <PermissionSelect
          label={t("teamsUi.coordinatorPermission")}
          value={offeredChoice(permission, modes.allowBypass)}
          allowBypass={modes.allowBypass}
          onChange={setPermission}
        />
      )}
      <fieldset className="form-stack">
        <legend className="legend-tight">{t("teamsUi.workersLegend")}</legend>
        {rows.map((row, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: a row has no identity besides its number
            key={i} // NOSONAR: a row has no identity besides its number
            data-slot="worker-row"
            className={modes.offered ? "worker-row" : "worker-row worker-row-lean"}
          >
            <PersonaPicker
              store={store}
              hostId={hostId}
              label={t("teamsUi.workerPersona", { n: i + 1 })}
              value={personaOf(row)}
              onChange={(value) => setRow(i, { persona: value })}
              idsOnly
            />
            <ModelSelect
              label={t("teamsUi.workerModel", { n: i + 1 })}
              defaultLabel={t("teamsUi.modelDefault")}
              value={row.model}
              onChange={(value) => setRow(i, { model: value })}
            />
            {modes.offered && (
              <PermissionSelect
                label={t("teamsUi.workerPermission", { n: i + 1 })}
                value={offeredChoice(row.permission, modes.allowBypass)}
                allowBypass={modes.allowBypass}
                onChange={(value) => setRow(i, { permission: value })}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={rows.length === 1}
              aria-label={t("teamsUi.removeRow", { n: i + 1 })}
              onClick={() => setRows((all) => all.filter((_, at) => at !== i))}
            >
              {t("teamsUi.removeButton")}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={rows.length >= 8}
          aria-label={t("teamsUi.addRow")}
          onClick={() => setRows((all) => [...all, { persona: null, model: "", permission: "" }])}
        >
          {t("teamsUi.addWorkerButton")}
        </Button>
      </fieldset>
      <FormActions
        sticky
        submit={t("teamsUi.create")}
        busy={creating}
        disabled={!goal.trim() || !projectId}
        disabledReason={t(goal.trim() ? "teamsUi.projectNeeded" : "teamsUi.goalNeeded")}
        cancel={t("teamsUi.cancel")}
        onCancel={props.onCancel}
      />
      {asking && (
        <ConfirmDialog
          message={t("teamsUi.bypassMessage", { host: modes.name })}
          confirmLabel={t("teamsUi.bypassConfirm")}
          destructive
          onConfirm={() => void create(true)}
          onCancel={() => setAsking(false)}
        />
      )}
    </form>
  );
}

/** What a member's row reads: the names and personas of its host (issue #101). */
const MEMBER_KEYS = ["names", "personas"] as const;

/** One member: its role, persona, state, card and last report, and the persona to switch to. */
export function TeamMemberRow(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    projectId: string;
    member: TeamMember;
    report: { text: string; at: string } | null;
    open: boolean;
    /** True once the host took it. */
    onPersona(persona: string): Promise<boolean>;
    onRemove(): void;
  }>,
) {
  const { store, member } = props;
  const { t } = store.i18n;
  const { names, personas } = useStoreSlice(store, MEMBER_KEYS);
  const [persona, setPersona, savedPersona] = useDraft(member.persona ?? "");
  const listed = personas[props.hostId];
  // Issue #101: the member's name in the person's language, by its persona, as everywhere else.
  const label =
    sessionLabel(
      {
        names: names[props.hostId]?.find((name) => name.sessionId === member.sessionId),
        createdName: member.name,
        personas: listed,
      },
      t,
    ) ?? member.name;
  const sessionId = member.sessionId;
  const openSession = () =>
    store.router.push({ name: "session", host: props.hostId, id: sessionId ?? "" });
  return (
    <li data-slot="team-member" className="stack-tight rounded-md border p-2 text-xs">
      <div data-slot="member-head" className="member-head">
        <div className="member-id">
          {sessionId ? (
            <Button variant="link" size="sm" onClick={openSession}>
              {label}
            </Button>
          ) : (
            <strong>{label}</strong>
          )}
          <Badge variant="outline">
            {t(member.role === "coordinator" ? "teamsUi.coordinator" : "teamsUi.worker")}
          </Badge>
          {member.persona && (
            <Badge variant="outline">
              {listed?.find((p) => p.id === member.persona)?.name ?? member.persona}
            </Badge>
          )}
          {member.model && <Badge variant="outline">{member.model}</Badge>}
        </div>
        <div data-slot="member-end" className="member-end">
          {member.sessionState && (
            <span className="text-muted-foreground">
              {t(`teamsUi.sessionStates.${member.sessionState}`)}
            </span>
          )}
          {sessionId && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("teamsUi.copyId", { name: label })}
                  onClick={() => {
                    void store.copyText(sessionId);
                    store.success(t("teamsUi.idCopied"));
                  }}
                >
                  <Copy aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{sessionId}</TooltipContent>
            </Tooltip>
          )}
          {sessionId && (
            <Button
              variant="link"
              size="sm"
              aria-label={t("teamsUi.openSessionOf", { name: label })}
              onClick={openSession}
            >
              {t("teamsUi.openSession")}
            </Button>
          )}
          {member.cardId && (
            <Button
              variant="link"
              size="sm"
              aria-label={t("teamsUi.openCardOf", { name: label })}
              onClick={() =>
                store.router.push({
                  name: "card",
                  host: props.hostId,
                  projectId: props.projectId,
                  cardId: member.cardId ?? "",
                })
              }
            >
              {t("teamsUi.openCard")}
            </Button>
          )}
        </div>
      </div>
      {props.report && (
        <p className="text-muted-foreground">
          {t("teamsUi.lastReport")}: {props.report.text}
        </p>
      )}
      {props.open && (
        <FieldRow align="end" slot="member-persona">
          <div data-slot="persona-field" className="persona-field">
            <PersonaPicker
              store={store}
              hostId={props.hostId}
              label={t("teamsUi.persona", { name: label })}
              value={persona}
              onChange={setPersona}
              idsOnly
            />
          </div>
          <Button
            variant="outline"
            aria-label={t("teamsUi.setPersona", { name: label })}
            onClick={async () => {
              const sent = persona;
              if (await props.onPersona(sent)) savedPersona(sent);
            }}
          >
            {t("teamsUi.setPersonaButton")}
          </Button>
          {member.role === "worker" && (
            <Button
              variant="outline"
              aria-label={t("teamsUi.remove", { name: label })}
              onClick={props.onRemove}
            >
              {t("teamsUi.removeButton")}
            </Button>
          )}
        </FieldRow>
      )}
    </li>
  );
}

/** The persona and model of a worker about to join a running team. */
function NewMember(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    team: TeamInfo;
    onAdd(member: { persona: string; model: string; permission: PermissionChoice }): void;
    onCancel(): void;
  }>,
) {
  const { store, team } = props;
  const { t } = store.i18n;
  const [persona, setPersona] = useState("");
  const [model, setModel] = useState("");
  const [permission, setPermission] = useState<PermissionChoice>("");
  const modes = useModes(store, props.hostId);
  return (
    <div className="row-end-wrap">
      <PersonaPicker
        store={store}
        hostId={props.hostId}
        label={t("teamsUi.newMemberPersona", { name: team.name })}
        value={persona}
        onChange={setPersona}
        idsOnly
      />
      <ModelSelect
        label={t("teamsUi.newMemberModel", { name: team.name })}
        defaultLabel={t("teamsUi.modelDefault")}
        value={model}
        onChange={setModel}
      />
      {modes.offered && (
        <PermissionSelect
          label={t("teamsUi.newMemberPermission", { name: team.name })}
          value={offeredChoice(permission, modes.allowBypass)}
          allowBypass={modes.allowBypass}
          onChange={setPermission}
        />
      )}
      <Button
        size="sm"
        aria-label={t("teamsUi.addMember", { name: team.name })}
        onClick={() =>
          props.onAdd({ persona, model, permission: offeredChoice(permission, modes.allowBypass) })
        }
      >
        {t("teamsUi.addMemberButton")}
      </Button>
      <Button variant="ghost" size="sm" onClick={props.onCancel}>
        {t("teamsUi.cancel")}
      </Button>
    </div>
  );
}

/** One team with its members and its controls. */
function Team(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    team: TeamInfo;
    status: TeamStatus | null;
    /** The team an alert opened. */
    focused: boolean;
    onChanged(team: TeamInfo): void;
  }>,
) {
  const { store, hostId, team } = props;
  const { t } = store.i18n;
  const [text, setText] = useState("");
  const [sent, setSent] = useState<{ delivered: number; refused: number } | null>(null);
  const [adding, setAdding] = useState(false);
  /** A worker set to Bypass waits here for the person's yes. */
  const [bypassing, setBypassing] = useState<{
    persona: string;
    model: string;
    permission: PermissionChoice;
  } | null>(null);
  const modes = useModes(store, hostId);
  const [confirm, setConfirm] = useState<
    { kind: "close" } | { kind: "remove"; member: string } | null
  >(null);
  const open = team.state !== "closed";
  const addMember = (member: { persona: string; model: string; permission: PermissionChoice }) => {
    setAdding(false);
    setBypassing(null);
    void act(
      store.hostCommand(hostId, "teams.update", {
        team: team.id,
        addMember: {
          persona: member.persona || null,
          model: member.model || null,
          ...(member.permission ? { permission: member.permission } : {}),
        },
      }),
    );
  };
  const act = async (command: Promise<TeamInfo | null>) => {
    const updated = await command;
    if (updated) props.onChanged(updated);
    return updated !== null;
  };
  const reportOf = (name: string) =>
    props.status?.members.find((m) => m.name === name)?.lastReport ?? null;
  const rowClass = `flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm${props.focused ? " ring-2 ring-ring" : ""}`;
  return (
    <li
      aria-label={t("teamsUi.row", { name: team.name })}
      {...(props.focused ? { "aria-current": "true" as const } : {})}
      className={rowClass}
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
          <TeamMemberRow
            key={member.name}
            store={store}
            hostId={hostId}
            projectId={team.projectId}
            member={member}
            report={reportOf(member.name)}
            open={open}
            onPersona={(persona) =>
              act(
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
        <div data-slot="team-footer" className="team-footer">
          <div className="team-row">
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
              onClick={() => setAdding(true)}
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
          {adding && (
            <NewMember
              store={store}
              hostId={hostId}
              team={team}
              onCancel={() => setAdding(false)}
              onAdd={(member) => {
                if (member.permission === "bypassPermissions") {
                  setBypassing(member);
                  return;
                }
                addMember(member);
              }}
            />
          )}
          <div className="team-row">
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
            {sent && <output>{t("teamsUi.sentAll", sent)}</output>}
          </div>
        </div>
      )}
      {bypassing && (
        <ConfirmDialog
          message={t("teamsUi.bypassMessage", { host: modes.name })}
          confirmLabel={t("teamsUi.bypassAddConfirm")}
          destructive
          onConfirm={() => addMember(bypassing)}
          onCancel={() => setBypassing(null)}
        />
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

const TEAMSPAGE_KEYS = ["hosts"] as const;

/** Phase 21: the teams of a host, a new one, and the controls of each. */
export const TeamsPage = memo(function TeamsPage(props: {
  store: AppStore;
  /** An alert opens the host and the team it is about; the team is listed first. */
  host?: string;
  team?: string;
  go(route: Route): void;
}) {
  const { store } = props;
  const state = useStoreSlice(store, TEAMSPAGE_KEYS);
  const { t } = store.i18n;
  const hosts = state.hosts.filter(
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "teams", false),
  );
  // The host shown: the route's (an alert), else a pick in the page's own select, else the
  // switcher's (#932), so the page never shows another host than the top bar without saying so.
  const switcherId = useSwitcherHostId(store) ?? "";
  /** A host picked in the page's own select: it holds until the next switch or alert. */
  const [picked, setPicked] = useState("");
  const lastSwitcher = useRef(switcherId);
  useEffect(() => {
    if (lastSwitcher.current === switcherId) return;
    lastSwitcher.current = switcherId;
    setPicked("");
  }, [switcherId]);
  // A later alert opens another host while the screen is already up.
  useEffect(() => {
    if (props.host) setPicked("");
  }, [props.host]);
  const wanted = picked || props.host || switcherId;
  const host = hosts.find((h) => h.id === wanted) ?? hosts[0];
  /** The host asked for when it has no teams to show: the page names it and the one shown. */
  const missed = host && wanted !== host.id ? state.hosts.find((h) => h.id === wanted) : undefined;
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
    await inSequence(list.teams, async (team) => {
      const status = await store.hostCommand(current, "teams.status", { team: team.id });
      if (status) next[team.id] = status;
    });
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
        <EmptyState
          icon={UsersRound}
          title={t("teamsUi.noHost")}
          action={
            <Button variant="link" onClick={() => store.router.push({ name: "add-host" })}>
              {t("teamsUi.noHostLink")}
            </Button>
          }
        />
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
            <NativeSelect
              inline
              aria-label={t("teamsUi.host")}
              value={current}
              onChange={(e) => setPicked(e.target.value)}
            >
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </NativeSelect>
          )}
          {!creating && <Button onClick={() => setCreating(true)}>{t("teamsUi.new")}</Button>}
        </div>
      }
    >
      {missed && (
        <InlineNotice tone="info">
          {t(missed.status === "online" ? "teamsUi.otherHost" : "teamsUi.otherHostOffline", {
            wanted: missed.name,
            shown: host.name,
          })}
        </InlineNotice>
      )}
      {creating && (
        <NewTeam
          store={store}
          hostId={current}
          onCreated={() => {
            setCreating(false);
            void load();
          }}
          onCancel={() => setCreating(false)}
          onOpenSettings={() => props.go({ name: "settings", section: "assistant" })}
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
        {[...teams]
          .sort((a, b) => Number(b.id === props.team) - Number(a.id === props.team))
          .map((team) => (
            <Team
              key={team.id}
              store={store}
              hostId={current}
              team={team}
              status={statuses[team.id] ?? null}
              focused={team.id === props.team}
              onChanged={() => void load()}
            />
          ))}
      </ul>
    </Page>
  );
});
