import type { SnippetContext } from "@flightdeck/protocol";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { AppState, AppStore } from "@/lib/app-store";
import type { AppSnippet } from "@/lib/global-snippets";

const SELECT = "h-9 rounded-md border bg-transparent px-2";

/** Which snippet the palette chose: one of a host's (`hostId`), or a global one of the app. */
export interface SnippetChoice {
  hostId: string | null;
  snippetId: string;
  /** The snippet itself, when it comes from a list the store does not keep (a project's). */
  snippet?: AppSnippet;
}

/** The snippet a choice names, from the host's list the palette read or from the app's globals. */
export function chosenSnippet(
  store: AppStore,
  state: AppState,
  choice: SnippetChoice,
): AppSnippet | undefined {
  if (choice.snippet) return choice.snippet;
  return choice.hostId
    ? state.snippets[choice.hostId]?.find((s) => s.id === choice.snippetId)
    : store.globalSnippets.list().find((s) => s.id === choice.snippetId);
}

/**
 * Phase 18: fills a snippet's fields and uses it: pasted into the terminal on screen (with Enter
 * or not), run in a new terminal tab at a folder, or copied. A command of an untrusted versioned
 * file only pastes.
 */
export function SnippetUse(props: {
  store: AppStore;
  state: AppState;
  choice: SnippetChoice;
  onClose(): void;
}) {
  const t = useT();
  const id = useId();
  const { store, state, choice } = props;
  const snippet = chosenSnippet(store, state, choice);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (snippet?.fields ?? []).map((f) => [f.name, f.default ?? f.options[0] ?? ""]),
    ),
  );
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!snippet) return null;

  const route = store.router.current;
  // A global snippet pastes into any host's terminal; a host's, only into that host's.
  const terminal =
    route.name === "terminal" && (choice.hostId === null || route.host === choice.hostId)
      ? route
      : null;
  const isCommand = snippet.type === "command";
  const own = Object.fromEntries(
    snippet.fields.filter((f) => !f.special).map((f) => [f.name, values[f.name] ?? ""]),
  );
  const context: SnippetContext = Object.fromEntries(
    snippet.fields
      .filter((f) => f.special && f.name !== "branch" && (values[f.name] ?? "") !== "")
      .map((f) => [f.name, values[f.name] as string]),
  );

  // A prompt goes to the managed session on screen (of this host, for a host's snippet).
  const session =
    route.name === "session" && (choice.hostId === null || route.host === choice.hostId)
      ? route
      : null;

  // Or to the controllable terminal session on screen.
  const external =
    route.name === "external" &&
    state.externals[`${route.host}/${route.claudeSessionId}`]?.controllable &&
    (choice.hostId === null || route.host === choice.hostId)
      ? route
      : null;

  const done = () => props.onClose();
  const fail = (message: string) => setError(message);

  const paste = async (enter: boolean) => {
    if (!terminal) return;
    if (choice.hostId === null) {
      const text = fillGlobal();
      if (text === null) return;
      await store
        .terminalHost(terminal.host)
        .write(terminal.terminalId, enter ? `${text}\r` : text);
      return done();
    }
    const result = await store.hostRequest(choice.hostId, "snippets.use", {
      id: snippet.id,
      action: "paste",
      terminalId: terminal.terminalId,
      values: own,
      context,
      enter,
    });
    return result.ok ? done() : fail(result.message);
  };

  /** A global command opens a terminal on the host on screen, else the first online one. */
  const runGlobalInNewTab = async () => {
    const hostId =
      ("host" in route ? route.host : undefined) ??
      state.hosts.find((h) => h.status === "online")?.id;
    if (!hostId) return;
    const text = fillGlobal();
    if (text === null) return;
    const { terminalId } = await store.terminalHost(hostId).open(folder, 120, 30);
    await store.terminalHost(hostId).write(terminalId, `${text}\r`);
    store.tabs.open({ name: "terminal", host: hostId, terminalId });
    done();
  };

  const runInNewTab = async () => {
    if (!choice.hostId) return runGlobalInNewTab();
    const result = await store.hostRequest(choice.hostId, "snippets.use", {
      id: snippet.id,
      action: "run",
      values: own,
      context: { ...context, cwd: folder },
    });
    if (!result.ok) return fail(result.message);
    if (result.data.terminal) {
      store.tabs.open({
        name: "terminal",
        host: choice.hostId,
        terminalId: result.data.terminal.terminalId,
      });
    }
    done();
  };

  /** A global snippet is filled by the app itself; the use counts. */
  const fillGlobal = (): string | null => {
    try {
      return store.globalSnippets.use(snippet.id, own, context);
    } catch (thrown) {
      fail((thrown as Error).message);
      return null;
    }
  };

  const send = async () => {
    if (!session && !external) return;
    if (choice.hostId === null) {
      const text = fillGlobal();
      if (text === null) return;
      if (external) {
        await store.hostCommand(external.host, "external.message", {
          claudeSessionId: external.claudeSessionId,
          text,
        });
      } else await store.send(text);
      return done();
    }
    const result = await store.hostRequest(choice.hostId, "snippets.use", {
      id: snippet.id,
      action: "send",
      ...(external ? { claudeSessionId: external.claudeSessionId } : { sessionId: session?.id }),
      values: own,
      context,
    });
    return result.ok ? done() : fail(result.message);
  };

  /** A new session on the snippet's host (a global one: the host on screen, else the first online). */
  const newSession = async () => {
    const hostId =
      choice.hostId ??
      ("host" in route ? route.host : undefined) ??
      state.hosts.find((h) => h.status === "online")?.id;
    if (!hostId) return;
    let text: string | null;
    if (choice.hostId === null) text = fillGlobal();
    else {
      const result = await store.hostRequest(choice.hostId, "snippets.render", {
        id: snippet.id,
        values: own,
        context,
      });
      // A field still to fill: the prompt goes as written, for the person to complete.
      text = result.ok ? result.data.text : (snippet.text ?? "");
    }
    if (text === null) return;
    store.router.push({ name: "new-session", host: hostId, prompt: text });
    done();
  };

  const copy = async () => {
    let text: string | null;
    if (choice.hostId === null) text = fillGlobal();
    else {
      const result = await store.hostRequest(choice.hostId, "snippets.render", {
        id: snippet.id,
        values: own,
        context,
      });
      if (!result.ok) return fail(result.message);
      text = result.data.text;
    }
    if (text === null) return;
    await store.copyText(text);
    done();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("snippets.use.title", { name: snippet.name })}</DialogTitle>
        </DialogHeader>
        <p className="break-all font-mono text-muted-foreground text-sm">
          {snippet.run ?? snippet.text}
        </p>
        {snippet.fields.map((field) => (
          <div key={field.name} className="flex flex-col gap-1 text-sm">
            <label htmlFor={`${id}-${field.name}`}>
              {field.special ? t("snippets.editor.special", { name: field.name }) : field.name}
            </label>
            {field.options.length > 0 ? (
              <select
                id={`${id}-${field.name}`}
                className={SELECT}
                value={values[field.name] ?? ""}
                onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
              >
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={`${id}-${field.name}`}
                value={values[field.name] ?? ""}
                onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
              />
            )}
          </div>
        ))}
        {isCommand && (
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor={`${id}-folder`}>{t("snippets.use.folder")}</label>
            <Input id={`${id}-folder`} value={folder} onChange={(e) => setFolder(e.target.value)} />
          </div>
        )}
        {!snippet.runnable && <p className="text-sm">{t("snippets.use.untrusted")}</p>}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <DialogFooter className="flex-wrap">
          {isCommand && terminal && (
            <>
              <Button variant="outline" onClick={() => void paste(false)}>
                {t("snippets.use.paste")}
              </Button>
              <Button disabled={!snippet.runnable} onClick={() => void paste(true)}>
                {t("snippets.use.pasteRun")}
              </Button>
            </>
          )}
          {isCommand && (
            <Button
              variant="outline"
              disabled={!snippet.runnable || folder.trim() === ""}
              onClick={() => void runInNewTab()}
            >
              {t("snippets.use.run")}
            </Button>
          )}
          {!isCommand && (session || external) && (
            <Button onClick={() => void send()}>{t("snippets.use.send")}</Button>
          )}
          {!isCommand && (
            <Button variant="outline" onClick={() => void newSession()}>
              {t("snippets.use.newSession")}
            </Button>
          )}
          <Button variant="outline" onClick={() => void copy()}>
            {t("snippets.use.copy")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
