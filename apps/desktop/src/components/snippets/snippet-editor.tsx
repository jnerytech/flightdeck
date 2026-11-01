import { SnippetModelError, type SnippetVar } from "@flightdeck/protocol";
import { useId, useState } from "react";
import { Form, FormActions } from "@/components/layout/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/context";
import { refusalText } from "@/i18n/errors";
import type { AppStore } from "@/lib/app-store";
import type { AppSnippet } from "@/lib/global-snippets";
import { placeholders, SPECIAL_VARS } from "@/lib/snippets";

const SELECT = "h-9 rounded-md border bg-transparent px-2";

type Place = "host" | "project" | "file" | "global";

const split = (text: string) =>
  text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

/** Creates or edits a snippet of the host or of the chosen project; it never holds a secret. */
export function SnippetEditor(props: {
  store: AppStore;
  hostId: string;
  /** The chosen project's path; "" for the host alone. */
  project: string;
  snippet: AppSnippet | null;
  onSaved(): void;
  onClose(): void;
  /** Offered when the daemon refuses a secret: phase 17's actions take secrets. */
  onMakeAction?(snippet: { name: string; command: string }): void;
}) {
  const t = useT();
  const id = useId();
  const { store, hostId, project, snippet } = props;
  const [name, setName] = useState(snippet?.name ?? "");
  const [type, setType] = useState<"command" | "prompt">(snippet?.type ?? "command");
  const [body, setBody] = useState(snippet?.run ?? snippet?.text ?? "");
  const [tags, setTags] = useState((snippet?.tags ?? []).join(", "));
  const [place, setPlace] = useState<Place>("host");
  const [defaults, setDefaults] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(snippet?.vars ?? {}).map(([k, v]) => [k, v.default ?? ""])),
  );
  const [options, setOptions] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(snippet?.vars ?? {}).map(([k, v]) => [k, (v.options ?? []).join(", ")]),
    ),
  );
  const [error, setError] = useState<{ secret: boolean; message: string } | null>(null);

  const names = placeholders(body);
  const own = names.filter((n) => !SPECIAL_VARS.includes(n));
  const ready = name.trim() !== "" && body.trim() !== "";

  const save = async () => {
    setError(null);
    const vars: Record<string, SnippetVar> = {};
    for (const n of own) {
      const def = defaults[n]?.trim() ?? "";
      const opts = split(options[n] ?? "");
      if (def || opts.length)
        vars[n] = { ...(def ? { default: def } : {}), ...(opts.length ? { options: opts } : {}) };
    }
    const fields = {
      name: name.trim(),
      type,
      ...(type === "command" ? { run: body.trim() } : { text: body }),
      vars,
      tags: split(tags),
    };
    if (snippet ? snippet.scope === "global" : place === "global") {
      try {
        store.globalSnippets.save({ ...(snippet ? { id: snippet.id } : {}), ...fields });
        return props.onSaved();
      } catch (thrown) {
        if (!(thrown instanceof SnippetModelError)) throw thrown;
        return setError(
          thrown.code === "snippet_secret"
            ? { secret: true, message: t("snippets.editor.secret") }
            : { secret: false, message: refusalText(thrown.code, thrown.message, t, thrown) },
        );
      }
    }
    const where = snippet
      ? {
          scope: snippet.scope === "project" ? ("project" as const) : ("host" as const),
          ...(snippet.projectPath ? { projectPath: snippet.projectPath } : {}),
        }
      : place === "host" || !project
        ? { scope: "host" as const }
        : {
            scope: "project" as const,
            projectPath: project,
            target: place === "file" ? ("file" as const) : ("daemon" as const),
          };
    const result = await store.hostRequest(hostId, "snippets.save", {
      ...(snippet ? { id: snippet.id } : {}),
      ...where,
      ...fields,
    });
    if (result.ok) return props.onSaved();
    setError(
      result.code === "snippet_secret"
        ? { secret: true, message: t("snippets.editor.secret") }
        : { secret: false, message: refusalText(result.code, result.message, t, result) },
    );
  };

  const field = (key: string, label: string, control: (fid: string) => React.ReactNode) => (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      {control(`${id}-${key}`)}
    </div>
  );

  return (
    <Form
      variant="panel"
      className="mb-4"
      onSubmit={() => {
        if (ready) void save();
      }}
    >
      {field("name", t("snippets.editor.name"), (fid) => (
        <Input id={fid} value={name} onChange={(e) => setName(e.target.value)} />
      ))}
      {field("type", t("snippets.editor.type"), (fid) => (
        <select
          id={fid}
          className={SELECT}
          value={type}
          onChange={(e) => setType(e.target.value as "command" | "prompt")}
        >
          <option value="command">{t("snippets.kind.command")}</option>
          <option value="prompt">{t("snippets.kind.prompt")}</option>
        </select>
      ))}
      {type === "command"
        ? field("run", t("snippets.editor.run"), (fid) => (
            <Input
              id={fid}
              className="font-mono"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          ))
        : field("text", t("snippets.editor.text"), (fid) => (
            <Textarea id={fid} value={body} onChange={(e) => setBody(e.target.value)} />
          ))}
      {names.length > 0 && (
        <div className="flex flex-col gap-1 text-sm">
          <span>{t("snippets.editor.fields")}</span>
          <ul aria-label={t("snippets.editor.fields")} className="flex flex-wrap gap-2">
            {names.map((n) => (
              <li key={n} className="rounded bg-muted px-1.5 font-mono text-xs">
                {SPECIAL_VARS.includes(n) ? t("snippets.editor.special", { name: n }) : n}
              </li>
            ))}
          </ul>
        </div>
      )}
      {own.map((n) => (
        <div key={n} className="flex flex-wrap gap-3">
          {field(`def-${n}`, t("snippets.editor.default", { name: n }), (fid) => (
            <Input
              id={fid}
              value={defaults[n] ?? ""}
              onChange={(e) => setDefaults({ ...defaults, [n]: e.target.value })}
            />
          ))}
          {field(`opt-${n}`, t("snippets.editor.options", { name: n }), (fid) => (
            <Input
              id={fid}
              value={options[n] ?? ""}
              onChange={(e) => setOptions({ ...options, [n]: e.target.value })}
            />
          ))}
        </div>
      ))}
      {field("tags", t("snippets.editor.tags"), (fid) => (
        <Input id={fid} value={tags} onChange={(e) => setTags(e.target.value)} />
      ))}
      {!snippet &&
        field("place", t("snippets.editor.place"), (fid) => (
          <select
            id={fid}
            className={SELECT}
            value={place}
            onChange={(e) => setPlace(e.target.value as Place)}
          >
            <option value="host">{t("snippets.editor.placeOption.host")}</option>
            <option value="global">{t("snippets.editor.placeOption.global")}</option>
            {project && <option value="project">{t("snippets.editor.placeOption.project")}</option>}
            {project && <option value="file">{t("snippets.editor.placeOption.file")}</option>}
          </select>
        ))}
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-destructive text-sm">
          <span>{error.message}</span>
          {error.secret && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!props.onMakeAction}
              onClick={() => props.onMakeAction?.({ name: name.trim(), command: body.trim() })}
            >
              {t("snippets.editor.makeAction")}
            </Button>
          )}
        </div>
      )}
      <FormActions
        submit={t("snippets.editor.save")}
        disabled={!ready}
        cancel={t("common.cancel")}
        onCancel={props.onClose}
      />
    </Form>
  );
}
