import type { CommandPayload, PermissionMode } from "@flightdeck/protocol";
import { useState } from "react";
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
  const roots = props.host.info?.allowedRoots ?? [];
  const [root, setRoot] = useState(roots[0] ?? "");
  const [sub, setSub] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<PermissionMode>("default");
  const [prompt, setPrompt] = useState("");
  return (
    <form
      className="card form"
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
      <h2>Nova sessão em {props.host.name}</h2>
      <label>
        Pasta
        <select value={root} onChange={(e) => setRoot(e.target.value)}>
          {roots.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label>
        Subpasta
        <input value={sub} onChange={(e) => setSub(e.target.value)} placeholder="opcional" />
      </label>
      <label>
        Nome
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="opcional" />
      </label>
      <label>
        Modo de permissão
        <select value={mode} onChange={(e) => setMode(e.target.value as PermissionMode)}>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label>
        Primeiro prompt
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>
      <button type="submit" className="primary">
        Criar sessão
      </button>
    </form>
  );
}
