import type { CommandPayload, PermissionMode } from "@flightdeck/protocol";
import { useState } from "react";
import { Field, Form, FormActions, NativeSelect } from "@/components/layout/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/context";
import type { Key } from "../i18n/index.ts";
import type { AppStore, HostView } from "../lib/app-store.ts";
import { isInside, trimTrailingSeparators } from "../lib/paths.ts";
import { hasFeature } from "../lib/version.ts";
import { FolderPicker } from "./FolderPicker.tsx";

const MODES: PermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
];

export function joinPath(root: string, sub: string): string {
  const sep = root.includes("\\") ? "\\" : "/";
  const clean = sub.trim().replace(/^[\\/]+/, "");
  return clean ? `${trimTrailingSeparators(root)}${sep}${clean}` : root;
}

/** New session on a host: folder inside one of its allowedRoots, name, permission mode, prompt. */
export function NewSessionForm(props: {
  host: HostView;
  /** Lets the folder be browsed on the host; without it the folder is typed. */
  store?: AppStore;
  onCreate(payload: CommandPayload<"session.create">): void | Promise<unknown>;
  /** The first prompt, filled in (a snippet, phase 18). */
  prompt?: string;
  /** More fields above Criar sessão: the persona picker (phase 20). */
  extra?: React.ReactNode;
}) {
  const t = useT();
  const roots = props.host.info?.allowedRoots ?? [];
  // The folder picked, else the host's first: its folders may arrive after the form opened.
  const [picked, setRoot] = useState<string | null>(null);
  const root = picked ?? roots[0] ?? "";
  const [sub, setSub] = useState("");
  const [browsing, setBrowsing] = useState(false);
  /** The host answers `fs.dirs`: an older daemon does not, and there the folder is typed. */
  const canBrowse =
    props.store !== undefined && hasFeature(props.host.hostInfo?.features, "fs.dirs", false);
  /** A folder the host resolved to a path none of its configured roots start: kept as a root. */
  const [extra, setExtra] = useState<string | null>(null);
  const folders = extra && !roots.includes(extra) ? [...roots, extra] : roots;
  const pick = (path: string) => {
    setBrowsing(false);
    // The configured root that holds it, the longest one; its rest is the subfolder.
    const holder = roots.filter((r) => isInside(path, r)).sort((a, b) => b.length - a.length)[0];
    if (holder) {
      setRoot(holder);
      setSub(path.slice(trimTrailingSeparators(holder).length).replace(/^[\\/]+/, ""));
    } else {
      setExtra(path);
      setRoot(path);
      setSub("");
    }
  };
  const [name, setName] = useState("");
  const [mode, setMode] = useState<PermissionMode>("default");
  const [prompt, setPrompt] = useState(props.prompt ?? "");
  /** The session is being created: the button is busy and a second press does nothing. */
  const [creating, setCreating] = useState(false);
  const submit = () => {
    if (!root || !prompt.trim() || creating) return;
    const done = props.onCreate({
      cwd: joinPath(root, sub),
      prompt: prompt.trim(),
      permissionMode: mode,
      ...(name.trim() ? { name: name.trim() } : {}),
    });
    if (typeof (done as PromiseLike<unknown> | undefined)?.then === "function") {
      setCreating(true);
      const finished = () => setCreating(false);
      (done as PromiseLike<unknown>).then(finished, finished);
    }
  };
  return (
    <Form onSubmit={submit} className="mx-auto p-6">
      <h2 className="font-semibold text-xl">{t("newSession.title", { host: props.host.name })}</h2>
      <Field label={t("newSession.folder")}>
        {(control) => (
          <NativeSelect {...control} value={root} onChange={(e) => setRoot(e.target.value)}>
            {folders.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field label={t("newSession.subfolder")}>
        {(control) => (
          <Input
            {...control}
            value={sub}
            onChange={(e) => setSub(e.target.value)}
            placeholder={t("newSession.optional")}
          />
        )}
      </Field>
      {canBrowse && (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => setBrowsing(true)}
        >
          {t("folderPicker.browse")}
        </Button>
      )}
      {browsing && props.store && canBrowse && (
        <FolderPicker
          store={props.store}
          host={props.host}
          onPick={pick}
          onClose={() => setBrowsing(false)}
        />
      )}
      <Field label={t("newSession.name")}>
        {(control) => (
          <Input
            {...control}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("newSession.optional")}
          />
        )}
      </Field>
      <Field label={t("newSession.mode")}>
        {(control) => (
          <>
            <NativeSelect
              {...control}
              value={mode}
              onChange={(e) => setMode(e.target.value as PermissionMode)}
            >
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {t("modes.option", {
                    name: t(`modes.${m}.name` as Key),
                    description: t(`modes.${m}.description` as Key),
                  })}
                </option>
              ))}
            </NativeSelect>
            {mode === "bypassPermissions" && (
              <p role="alert" className="text-status-error text-xs">
                {t("modes.bypassWarning")}
              </p>
            )}
          </>
        )}
      </Field>
      <Field label={t("newSession.prompt")}>
        {(control) => (
          <Textarea
            {...control}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="min-h-28"
          />
        )}
      </Field>
      {props.extra}
      <FormActions
        submit={t("newSession.create")}
        busy={creating}
        disabled={!root || !prompt.trim()}
        disabledReason={t(root ? "newSession.needPrompt" : "newSession.needFolder")}
      />
    </Form>
  );
}
