import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AssistField } from "@/features/assistant/ui.ts";
import type { PermissionChoice } from "@/features/personas/index.ts";
import {
  EffortSelect,
  ModelSelect,
  PermissionSelect,
  PersonaPicker,
  useSuggestedPersona,
} from "@/features/personas/ui.ts";
import { AddProject } from "@/features/projects/ui.ts";
import { useStoreState } from "@/lib/use-store";
import { ConfirmDialog } from "@/shared/feedback/index.ts";
import { Field, FormActions, NativeSelect } from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import {
  bypassAsked,
  chosenProject,
  createPayload,
  type EffortChoice,
  effortOffered,
  type NewTeamRow,
  offeredChoice,
  rowPersona,
} from "./domain/new-team.ts";
import { useModes, usePersonaModels } from "./use-modes.ts";

/** A team has at most this many workers. */
const MAX_WORKERS = 8;

/** The controls a worker row holds: the first one takes the focus when a row goes (#2646). */
const ROW_CONTROLS = "select, input, textarea, button:not(:disabled)";

/** The form of a new team: the goal, the project, the workers and the coordinator's persona. */
export function NewTeam(
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
    void store.projectList.load(hostId).finally(() => setAsked(true));
  }, [store, hostId]);
  const [goal, setGoal] = useState("");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState("");
  const projectId = chosenProject(projects, picked);
  const [persona, setPersona] = useState("");
  const [model, setModel] = useState("");
  const modes = useModes(store, hostId);
  const personaModels = usePersonaModels(store, hostId);
  const [effort, setEffort] = useState<EffortChoice>("");
  const [permission, setPermission] = useState<PermissionChoice>("");
  /** Bypass asks again each time the team is created. */
  const [asking, setAsking] = useState(false);
  /**
   * One row per worker: the row's persona, model and permission mode ("" is the default). A persona
   * nobody picked is `null` and shows the Developer when the host has it.
   */
  const [rows, setRows] = useState<NewTeamRow[]>([
    { persona: null, model: "", effort: "", permission: "" },
    { persona: null, model: "", effort: "", permission: "" },
  ]);
  const setRow = (index: number, change: Partial<NewTeamRow>) =>
    setRows((all) => all.map((row, i) => (i === index ? { ...row, ...change } : row)));
  const workerDefault = useSuggestedPersona(store, hostId, "dev", true);
  const personaOf = (row: NewTeamRow) => rowPersona(row, workerDefault);
  const effortShown = (member: string, personaId: string) =>
    effortOffered({ efforts: modes.efforts, personaModels }, member, personaId);
  const [creating, setCreating] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const limits = useId();
  /** The row that takes the focus once the rows are redrawn: the place of a removed one, or the last one added at the limit (#2646). */
  const focusAt = useRef<number | null>(null);
  useEffect(() => {
    const at = focusAt.current;
    if (at === null) return;
    focusAt.current = null;
    const worker = form.current?.querySelectorAll<HTMLElement>('[data-slot="worker-row"]')[
      Math.min(at, rows.length - 1)
    ];
    worker?.querySelector<HTMLElement>(ROW_CONTROLS)?.focus();
  }, [rows.length]);
  // A second submit before the first answered would create the team twice.
  const inFlight = useRef(false);
  const create = async (confirmed = false) => {
    if (inFlight.current) return;
    const form = {
      projectId,
      goal,
      name,
      persona,
      model,
      effort,
      permission,
      rows,
      workerDefault,
      modes,
      efforts: modes.efforts,
      personaModels,
    };
    if (bypassAsked(form) && !confirmed) {
      setAsking(true);
      return;
    }
    setAsking(false);
    inFlight.current = true;
    setCreating(true);
    const team = await store.hostCommand(hostId, "teams.create", createPayload(form));
    inFlight.current = false;
    setCreating(false);
    if (team) props.onCreated();
  };
  return (
    <form
      ref={form}
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
      {effortShown(model, persona) && (
        <EffortSelect
          label={t("teamsUi.coordinatorEffort")}
          defaultLabel={t("teamsUi.effortDefault")}
          value={effort}
          onChange={setEffort}
        />
      )}
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
            className="worker-row"
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
            {effortShown(row.model, personaOf(row)) && (
              <EffortSelect
                label={t("teamsUi.workerEffort", { n: i + 1 })}
                defaultLabel={t("teamsUi.effortDefault")}
                value={row.effort}
                onChange={(value) => setRow(i, { effort: value })}
              />
            )}
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
              aria-describedby={rows.length === 1 ? `${limits}-min` : undefined}
              aria-label={t("teamsUi.removeRow", { n: i + 1 })}
              onClick={() => {
                focusAt.current = i;
                setRows((all) => all.filter((_, at) => at !== i));
              }}
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
          disabled={rows.length >= MAX_WORKERS}
          aria-describedby={rows.length >= MAX_WORKERS ? `${limits}-max` : undefined}
          aria-label={t("teamsUi.addRow")}
          onClick={() => {
            // The button turns off on the click that adds the last row: the focus goes to that row.
            if (rows.length + 1 >= MAX_WORKERS) focusAt.current = rows.length;
            setRows((all) => [...all, { persona: null, model: "", effort: "", permission: "" }]);
          }}
        >
          {t("teamsUi.addWorkerButton")}
        </Button>
        {rows.length === 1 && (
          <p id={`${limits}-min`} className="text-muted-foreground text-xs">
            {t("teamsUi.workersMin")}
          </p>
        )}
        {rows.length >= MAX_WORKERS && (
          <p id={`${limits}-max`} className="text-muted-foreground text-xs">
            {t("teamsUi.workersMax", { max: MAX_WORKERS })}
          </p>
        )}
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
