import { useEffect, useRef, useState } from "react";
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
} from "./new-team.ts";
import { useModes, usePersonaModels } from "./use-modes.ts";

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
          onClick={() =>
            setRows((all) => [...all, { persona: null, model: "", effort: "", permission: "" }])
          }
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
