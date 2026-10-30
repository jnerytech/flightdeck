import type { CommandPayload, PermissionMode } from "@flightdeck/protocol";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/context";
import type { Key } from "../i18n/index.ts";
import type { HostView } from "../lib/app-store.ts";

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
  return clean ? `${root.replace(/[\\/]+$/, "")}${sep}${clean}` : root;
}

/** New session on a host: folder inside one of its allowedRoots, name, permission mode, prompt. */
export function NewSessionForm(props: {
  host: HostView;
  onCreate(payload: CommandPayload<"session.create">): void;
}) {
  const t = useT();
  const id = useId();
  const roots = props.host.info?.allowedRoots ?? [];
  const [root, setRoot] = useState(roots[0] ?? "");
  const [sub, setSub] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<PermissionMode>("default");
  const [prompt, setPrompt] = useState("");
  const field = "flex flex-col gap-1 text-sm";
  const select =
    "h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <form
      className="mx-auto flex max-w-xl flex-col gap-4 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!root || !prompt.trim()) return;
        props.onCreate({
          cwd: joinPath(root, sub),
          prompt: prompt.trim(),
          permissionMode: mode,
          ...(name.trim() ? { name: name.trim() } : {}),
        });
      }}
    >
      <h2 className="font-semibold text-xl">Nova sessão em {props.host.name}</h2>
      <label className={field}>
        {t("newSession.folder")}
        <select className={select} value={root} onChange={(e) => setRoot(e.target.value)}>
          {roots.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className={field} htmlFor={`${id}-sub`}>
        {t("newSession.subfolder")}
        <Input
          id={`${id}-sub`}
          value={sub}
          onChange={(e) => setSub(e.target.value)}
          placeholder={t("newSession.optional")}
        />
      </label>
      <label className={field} htmlFor={`${id}-name`}>
        {t("newSession.name")}
        <Input
          id={`${id}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("newSession.optional")}
        />
      </label>
      <label className={field}>
        {t("newSession.mode")}
        <select
          className={select}
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
        </select>
        {mode === "bypassPermissions" && (
          <p role="alert" className="text-status-error text-xs">
            {t("modes.bypassWarning")}
          </p>
        )}
      </label>
      <label className={field} htmlFor={`${id}-prompt`}>
        {t("newSession.prompt")}
        <Textarea
          id={`${id}-prompt`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="min-h-28"
        />
      </label>
      <Button type="submit" className="self-start">
        {t("newSession.create")}
      </Button>
    </form>
  );
}
