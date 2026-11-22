import {
  PERSONA_ICON_PATTERN,
  PERSONA_ID_PATTERN,
  type PersonaInput,
  PersonaModelError,
} from "@flightdeck/protocol";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AssistField } from "@/features/assistant/ui.ts";
import { MAIN_MODELS, MORE_MODELS, modelName } from "@/features/models/index.ts";
import { useT } from "@/i18n/context";
import { reasonText } from "@/i18n/errors.ts";
import type { AppStore } from "@/lib/app-store";
import { useBusy } from "@/shared/hooks/index.ts";
import { Field, Form, FormActions, NativeSelect } from "@/shared/layout/index.ts";
import { type AppPersona, personaInput } from "./domain/global-personas.ts";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const MODES = ["default", "acceptEdits", "plan", "dontAsk", "auto"] as const;

type Place = "host" | "app" | "project";

/** The models the select offers: the aliases, then the current versions. */
const KNOWN_MODELS: readonly string[] = [...MAIN_MODELS, ...MORE_MODELS];
const OTHER = "__other__";

/** The tools the checkboxes offer; a persona's own extra ones are kept among them too. */
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
const KNOWN_TOOL_SET: ReadonlySet<string> = new Set(KNOWN_TOOLS);

/** Where a persona lives: the app, a project, or (the default) the host. */
function placeOf(scope: string | undefined): Place {
  if (scope === "app" || scope === "project") return scope;
  return "host";
}

/**
 * Phase 20: creates or edits a persona, with a preview of what a session opened in it gets. A
 * pack persona edited here becomes the host's version of it; the id never changes.
 */
export function PersonaEditor(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    /** The chosen project's path; "" for none. */
    project: string;
    persona: AppPersona | null;
    onSaved(): void;
    onClose(): void;
    /** Opens Settings, section Assistant (the wand found no provider). */
    onOpenSettings(): void;
  }>,
) {
  const t = useT();
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
  const [place, setPlace] = useState<Place>(placeOf(persona?.scope));
  const [error, setError] = useState<string | null>(null);
  // The id and the icon rules are said once the person leaves the field, not while they type.
  const [left, setLeft] = useState({ id: false, icon: false });
  const firstField = useRef<HTMLInputElement>(null);

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
  // An existing persona's id never changes, so only a new one is held to the rule.
  const idBad = persona === null && pid.trim() !== "" && !PERSONA_ID_PATTERN.test(pid.trim());
  const iconBad = icon.trim() !== "" && !PERSONA_ICON_PATTERN.test(icon.trim());
  const problems = [
    ...((persona === null && pid.trim() === "") || idBad ? [t("personas.editor.id")] : []),
    ...(name.trim() === "" ? [t("personas.editor.name")] : []),
    ...(description.trim() === "" ? [t("personas.editor.description")] : []),
    ...(body.trim() === "" ? [t("personas.editor.body")] : []),
    ...(iconBad ? [t("personas.editor.icon")] : []),
  ];
  const ready = problems.length === 0;

  /** A level or mode the picker offers is shown by its name; any other value stays as stored. */
  const effortName = (value: string) =>
    (EFFORTS as readonly string[]).includes(value)
      ? t(`efforts.${value as (typeof EFFORTS)[number]}.name`)
      : value || null;
  const modeName = (value: string) =>
    (MODES as readonly string[]).includes(value)
      ? t(`modes.${value as (typeof MODES)[number]}.name`)
      : value;

  const refused = (
    code: string,
    message: string,
    why?: { reason?: string; params?: Record<string, string | number> },
  ) =>
    setError(
      code === "persona_secret"
        ? t("personas.editor.secret")
        : reasonText(t, message, why?.reason, why?.params),
    );

  const save = async () => {
    setError(null);
    if (place === "app") {
      try {
        store.personas.global.save(input);
        return props.onSaved();
      } catch (error_) {
        if (!(error_ instanceof PersonaModelError)) throw error_;
        return refused(error_.code, error_.message, {
          reason: error_.reason,
          ...(error_.params ? { params: error_.params } : {}),
        });
      }
    }
    const result = await store.hostRequest(hostId, "personas.save", {
      scope: place === "project" ? "project" : "host",
      ...(place === "project" ? { projectPath: project } : {}),
      persona: input,
    });
    if (result.ok) props.onSaved();
    else refused(result.code, result.message, result);
  };

  const toolList = tools;
  const toolChoices = [...KNOWN_TOOLS, ...tools.filter((tool) => !KNOWN_TOOL_SET.has(tool))];
  // The form opens where the person is: its first field takes the focus and it scrolls into view.
  useEffect(() => {
    firstField.current?.focus();
    firstField.current?.closest("form")?.scrollIntoView?.({ block: "nearest" });
  }, []);

  return (
    <Form
      variant="panel"
      onSubmit={() => {
        // A refused Enter says why on the fields, not only under Save.
        setLeft({ id: true, icon: true });
        if (ready) saving.run(save);
      }}
    >
      <Field
        label={t("personas.editor.id")}
        help={t("personas.editor.idHelp")}
        error={left.id && idBad ? t("personas.editor.idInvalid") : undefined}
      >
        {(control) => (
          <Input
            {...control}
            ref={persona === null ? firstField : undefined}
            aria-required={persona === null}
            value={pid}
            disabled={persona !== null}
            onChange={(e) => setPid(e.target.value)}
            onBlur={() => setLeft((was) => ({ ...was, id: true }))}
          />
        )}
      </Field>
      <Field label={t("personas.editor.name")} help={t("personas.editor.required")}>
        {(control) => (
          <Input
            {...control}
            ref={persona === null ? undefined : firstField}
            aria-required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <Field label={t("personas.editor.description")} help={t("personas.editor.required")}>
        {(control) => (
          <AssistField
            binding={{
              controller: store.assistant,
              kind: "persona.description",
              fieldHostId: hostId,
              ...(name.trim() ? { context: { name } } : {}),
              openSettings: props.onOpenSettings,
            }}
            value={description}
            onChange={setDescription}
            t={t}
          >
            {(assist) => (
              <Input
                {...control}
                {...assist}
                aria-required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </AssistField>
        )}
      </Field>
      <Field
        label={t("personas.editor.icon")}
        help={t("personas.editor.iconHelp")}
        error={left.icon && iconBad ? t("personas.editor.iconInvalid") : undefined}
      >
        {(control) => (
          <Input
            {...control}
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            onBlur={() => setLeft((was) => ({ ...was, icon: true }))}
          />
        )}
      </Field>
      <Field label={t("personas.editor.model")}>
        {(control) => (
          <NativeSelect
            {...control}
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
                {modelName(m) ?? m}
              </option>
            ))}
            <option value={OTHER}>{t("personas.editor.otherModel")}</option>
          </NativeSelect>
        )}
      </Field>
      {other && (
        <Field label={t("personas.editor.otherModelLabel")}>
          {(control) => (
            <Input {...control} value={model} onChange={(e) => setModel(e.target.value)} />
          )}
        </Field>
      )}
      <Field label={t("personas.editor.effort")}>
        {(control) => (
          <NativeSelect {...control} value={effort} onChange={(e) => setEffort(e.target.value)}>
            <option value="">{t("personas.editor.none")}</option>
            {EFFORTS.map((e) => (
              <option key={e} value={e}>
                {t(`efforts.${e}.name`)}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      {/* Issue #237: one checkbox per tool, so each click adds or removes that tool only (a
          native multi-select dropped the others on a plain click). */}
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend>{t("personas.editor.tools")}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {toolChoices.map((tool) => (
            <label key={tool} className="hit-inline gap-2">
              <input
                type="checkbox"
                className="hit-control"
                checked={tools.includes(tool)}
                onChange={(e) =>
                  setTools(
                    toolChoices.filter((choice) =>
                      choice === tool ? e.target.checked : tools.includes(choice),
                    ),
                  )
                }
              />
              {tool}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label={t("personas.editor.mode")}>
        {(control) => (
          <NativeSelect {...control} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">{t("personas.editor.none")}</option>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {t(`modes.${m}.name`)}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field label={t("personas.editor.body")} help={t("personas.editor.required")}>
        {(control) => (
          <AssistField
            binding={{
              controller: store.assistant,
              kind: "persona.instructions",
              fieldHostId: hostId,
              context: {
                ...(name.trim() ? { name } : {}),
                ...(description.trim() ? { description } : {}),
              },
              openSettings: props.onOpenSettings,
            }}
            value={body}
            onChange={setBody}
            t={t}
          >
            {(assist) => (
              <Textarea
                {...control}
                {...assist}
                aria-required
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            )}
          </AssistField>
        )}
      </Field>
      {persona === null && (
        <Field label={t("personas.editor.place")}>
          {(control) => (
            <NativeSelect
              {...control}
              value={place}
              onChange={(e) => setPlace(e.target.value as Place)}
            >
              <option value="host">{t("personas.editor.placeOption.host")}</option>
              <option value="app">{t("personas.editor.placeOption.app")}</option>
              {project && (
                <option value="project">{t("personas.editor.placeOption.project")}</option>
              )}
            </NativeSelect>
          )}
        </Field>
      )}
      <section
        aria-label={t("personas.editor.preview")}
        className="flex flex-col gap-1 rounded-md bg-muted/40 p-3 text-sm"
      >
        <p className="font-medium">{t("personas.editor.appended")}</p>
        <p className="whitespace-pre-wrap font-mono text-xs">{body}</p>
        <p>
          {t("personas.editor.modelLine", {
            model: model.trim() || t("personas.editor.sessionDefault"),
            effort: effortName(effort) ?? t("personas.editor.sessionDefault"),
          })}
        </p>
        <p>
          {toolList.length > 0
            ? t("personas.editor.toolsOnly", { tools: toolList.join(", ") })
            : t("personas.editor.toolsAll")}
        </p>
        {mode && <p>{t("personas.editor.modeLine", { mode: modeName(mode) })}</p>}
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
        disabledReason={t("personas.editor.saveOff", { fields: problems.join(", ") })}
        cancel={t("common.cancel")}
        onCancel={props.onClose}
      />
    </Form>
  );
}
