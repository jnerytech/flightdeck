import { type PersonaInput, PersonaModelError } from "@flightdeck/protocol";
import { useEffect, useId, useState } from "react";
import { Form, FormActions } from "@/components/layout/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useBusy } from "@/hooks/use-busy";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { type AppPersona, personaInput } from "@/lib/global-personas";
import { cn } from "@/lib/utils";
import { MODELS } from "./model-select";

const SELECT = "h-9 rounded-md border bg-transparent px-2";
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const MODES = ["default", "acceptEdits", "plan", "dontAsk", "auto"] as const;

type Place = "host" | "app" | "project";

/** The models the select offers: the aliases and the ids the pack's personas use. */
const KNOWN_MODELS: readonly string[] = [
  ...MODELS,
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
  "claude-fable-5-1",
];
const OTHER = "__other__";

/** The tools the multi-select offers; a persona's own extra ones are kept in it too. */
const KNOWN_TOOLS: readonly string[] = [
  "Read",
  "Grep",
  "Glob",
  "Bash",
  "Edit",
  "Write",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "Task",
  "TodoWrite",
  "mcp__flightdeck",
];

/**
 * Phase 20: creates or edits a persona, with a preview of what a session opened in it gets. A
 * pack persona edited here becomes the host's version of it; the id never changes.
 */
export function PersonaEditor(props: {
  store: AppStore;
  hostId: string;
  /** The chosen project's path; "" for none. */
  project: string;
  persona: AppPersona | null;
  /** Shown inside the persona's own card, not above the list. */
  inPlace?: boolean;
  onSaved(): void;
  onClose(): void;
}) {
  const t = useT();
  const id = useId();
  const saving = useBusy();
  const { store, hostId, project, persona } = props;
  const [pid, setPid] = useState(persona?.id ?? "");
  const [name, setName] = useState(persona?.name ?? "");
  const [description, setDescription] = useState(persona?.description ?? "");
  const [icon, setIcon] = useState(persona?.icon ?? "");
  const [model, setModel] = useState(persona?.model ?? "");
  // A model the list does not know opens on "Other…" with it typed.
  const [other, setOther] = useState(
    Boolean(persona?.model) && !KNOWN_MODELS.includes(persona?.model ?? ""),
  );
  const [effort, setEffort] = useState<string>(persona?.effort ?? "");
  const [tools, setTools] = useState<string[]>(persona?.tools ?? []);
  const [mode, setMode] = useState<string>(persona?.permissionMode ?? "");
  const [body, setBody] = useState(persona?.body ?? "");
  const initialPlace: Place =
    persona?.scope === "app" ? "app" : persona?.scope === "project" ? "project" : "host";
  const [place, setPlace] = useState<Place>(initialPlace);
  const [error, setError] = useState<string | null>(null);

  const input: PersonaInput = personaInput({
    id: pid.trim(),
    name: name.trim(),
    description: description.trim(),
    icon: icon.trim() || null,
    model: model.trim() || null,
    effort: (effort || null) as AppPersona["effort"],
    tools: tools.length > 0 ? tools : null,
    permissionMode: (mode || null) as AppPersona["permissionMode"],
    body,
  });
  const ready =
    pid.trim() !== "" && name.trim() !== "" && description.trim() !== "" && body.trim() !== "";

  const refused = (code: string, message: string) =>
    setError(code === "persona_secret" ? t("personas.editor.secret") : message);

  const save = async () => {
    setError(null);
    if (place === "app") {
      try {
        store.globalPersonas.save(input);
        return props.onSaved();
      } catch (thrown) {
        if (!(thrown instanceof PersonaModelError)) throw thrown;
        return refused(thrown.code, thrown.message);
      }
    }
    const result = await store.hostRequest(hostId, "personas.save", {
      scope: place === "project" ? "project" : "host",
      ...(place === "project" ? { projectPath: project } : {}),
      persona: input,
    });
    if (result.ok) props.onSaved();
    else refused(result.code, result.message);
  };

  const field = (key: string, label: string, control: (fid: string) => React.ReactNode) => (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      {control(`${id}-${key}`)}
    </div>
  );
  const toolList = tools;
  const toolChoices = [...KNOWN_TOOLS, ...tools.filter((tool) => !KNOWN_TOOLS.includes(tool))];
  // The form opens where the person is: its first field takes the focus and it scrolls into view.
  const first = persona === null ? "id" : "name";
  useEffect(() => {
    const field = document.getElementById(`${id}-${first}`);
    field?.focus();
    field?.closest("form")?.scrollIntoView?.({ block: "nearest" });
  }, [id, first]);

  return (
    <Form
      variant="panel"
      className={props.inPlace ? undefined : "mb-4"}
      onSubmit={() => {
        if (ready) saving.run(save);
      }}
    >
      {field("id", t("personas.editor.id"), (fid) => (
        <Input
          id={fid}
          value={pid}
          disabled={persona !== null}
          onChange={(e) => setPid(e.target.value)}
        />
      ))}
      {field("name", t("personas.editor.name"), (fid) => (
        <Input id={fid} value={name} onChange={(e) => setName(e.target.value)} />
      ))}
      {field("description", t("personas.editor.description"), (fid) => (
        <Input id={fid} value={description} onChange={(e) => setDescription(e.target.value)} />
      ))}
      {field("icon", t("personas.editor.icon"), (fid) => (
        <Input id={fid} value={icon} onChange={(e) => setIcon(e.target.value)} />
      ))}
      {field("model", t("personas.editor.model"), (fid) => (
        <select
          id={fid}
          className={SELECT}
          value={other ? OTHER : model}
          onChange={(e) => {
            const choice = e.target.value;
            setOther(choice === OTHER);
            setModel(choice === OTHER ? "" : choice);
          }}
        >
          <option value="">{t("personas.editor.none")}</option>
          {KNOWN_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
          <option value={OTHER}>{t("personas.editor.otherModel")}</option>
        </select>
      ))}
      {other &&
        field("model-other", t("personas.editor.otherModelLabel"), (fid) => (
          <Input id={fid} value={model} onChange={(e) => setModel(e.target.value)} />
        ))}
      {field("effort", t("personas.editor.effort"), (fid) => (
        <select
          id={fid}
          className={SELECT}
          value={effort}
          onChange={(e) => setEffort(e.target.value)}
        >
          <option value="">{t("personas.editor.none")}</option>
          {EFFORTS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      ))}
      {field("tools", t("personas.editor.tools"), (fid) => (
        <select
          id={fid}
          multiple
          className={cn(SELECT, "h-32")}
          value={tools}
          onChange={(e) => setTools([...e.target.selectedOptions].map((o) => o.value))}
        >
          {toolChoices.map((tool) => (
            <option key={tool} value={tool}>
              {tool}
            </option>
          ))}
        </select>
      ))}
      {field("mode", t("personas.editor.mode"), (fid) => (
        <select id={fid} className={SELECT} value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="">{t("personas.editor.none")}</option>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      ))}
      {field("body", t("personas.editor.body"), (fid) => (
        <Textarea id={fid} rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
      ))}
      {persona === null &&
        field("place", t("personas.editor.place"), (fid) => (
          <select
            id={fid}
            className={SELECT}
            value={place}
            onChange={(e) => setPlace(e.target.value as Place)}
          >
            <option value="host">{t("personas.editor.placeOption.host")}</option>
            <option value="app">{t("personas.editor.placeOption.app")}</option>
            {project && <option value="project">{t("personas.editor.placeOption.project")}</option>}
          </select>
        ))}
      <section
        aria-label={t("personas.editor.preview")}
        className="flex flex-col gap-1 rounded-md bg-muted/40 p-3 text-sm"
      >
        <p className="font-medium">{t("personas.editor.appended")}</p>
        <p className="whitespace-pre-wrap font-mono text-xs">{body}</p>
        <p>
          {t("personas.editor.modelLine", {
            model: model.trim() || t("personas.editor.sessionDefault"),
            effort: effort || t("personas.editor.sessionDefault"),
          })}
        </p>
        <p>
          {toolList.length > 0
            ? t("personas.editor.toolsOnly", { tools: toolList.join(", ") })
            : t("personas.editor.toolsAll")}
        </p>
        {mode && <p>{t("personas.editor.modeLine", { mode })}</p>}
      </section>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <FormActions
        submit={t("personas.editor.save")}
        busy={saving.busy}
        disabled={!ready}
        cancel={t("common.cancel")}
        onCancel={props.onClose}
      />
    </Form>
  );
}
