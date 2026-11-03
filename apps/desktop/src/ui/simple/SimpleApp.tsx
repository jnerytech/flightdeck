import type { TaskFile, TaskResultsResult, Template } from "@flightdeck/protocol";
import { FolderOpen, Home, Settings as SettingsIcon } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { HomeView } from "@/components/simple/home-view";
import { SettingsView } from "@/components/simple/settings-view";
import { TaskView } from "@/components/simple/task-view";
import { Button } from "@/components/ui/button";
import { translator } from "../../i18n/index.ts";
import { type AppState, type AppStore, sessionKey } from "../../lib/app-store.ts";
import { basename } from "../../lib/paths.ts";
import { taskState } from "../../lib/simple-task.ts";
import { useSessionState } from "../../lib/use-store.ts";

type Screen =
  | { name: "home" }
  | { name: "task"; sessionId: string }
  | { name: "files" }
  | { name: "settings" };

const STATE_OF = {
  starting: "working",
  running: "working",
  awaiting_permission: "waiting",
  idle: "done",
  ended: "stopped",
  error: "failed",
} as const;

/** One task: its conversation underneath, only the result on top. */
function TaskScreen(props: {
  store: AppStore;
  hostId: string;
  sessionId: string;
  title: string;
  locked: boolean;
  t: ReturnType<typeof translator>;
  onBack(): void;
  onDetails(): void;
}) {
  const { store, hostId, sessionId, t } = props;
  useEffect(() => store.watchSession(hostId, sessionId), [store, hostId, sessionId]);
  const session = useSessionState(store, sessionKey(hostId, sessionId));
  const state = taskState(session);
  const [results, setResults] = useState<TaskResultsResult | null>(null);
  // What the task made is asked for when it is done, and again after each reply.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `lastSeq` re-asks after each reply
  useEffect(() => {
    if (state !== "done" && state !== "stopped" && state !== "failed") return;
    let alive = true;
    void store.hostRequest(hostId, "task.results", { sessionId }).then((answer) => {
      if (alive) setResults(answer.ok ? answer.data : { files: [], truncated: false });
    });
    return () => {
      alive = false;
    };
  }, [store, hostId, sessionId, state, session.lastSeq]);

  const lastUser = [...session.items].reverse().find((item) => item.kind === "user");
  return (
    <TaskView
      title={props.title}
      session={session}
      results={results}
      t={t}
      locked={props.locked}
      canOpen={store.canOpenPaths(hostId)}
      onBack={props.onBack}
      onStop={() => void store.hostCommand(hostId, "session.close", { sessionId })}
      onAnswer={(requestId, decision) => void store.respondTo(hostId, requestId, decision)}
      onOpenFull={props.onDetails}
      onCopy={(text) => void store.copyText(text)}
      onOpenFile={(path) => void store.openPath(hostId, path)}
      onRevealFile={(path) => void store.revealPath(hostId, path)}
      onPreview={async (path) => {
        const answer = await store.hostRequest(hostId, "task.preview", { sessionId, path });
        return answer.ok ? answer.data : null;
      }}
      onAskChanges={(text) => void store.sendTo(hostId, sessionId, text)}
      onTryAgain={() => {
        if (lastUser?.kind === "user") void store.sendTo(hostId, sessionId, lastUser.text);
      }}
      onShowDetails={props.onDetails}
    />
  );
}

/** Every file the recent tasks made, newest first. */
function FilesScreen(props: {
  store: AppStore;
  hostId: string;
  tasks: Array<{ id: string; title: string }>;
  t: ReturnType<typeof translator>;
}) {
  const { store, hostId, t } = props;
  const [rows, setRows] = useState<Array<{ task: string; file: TaskFile }>>([]);
  const ids = props.tasks.map((task) => task.id).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `ids` stands for the list of tasks
  useEffect(() => {
    let alive = true;
    void (async () => {
      const found: Array<{ task: string; file: TaskFile }> = [];
      for (const task of props.tasks.slice(0, 10)) {
        const answer = await store.hostRequest(hostId, "task.results", { sessionId: task.id });
        if (answer.ok) for (const file of answer.data.files) found.push({ task: task.title, file });
      }
      found.sort((a, b) => b.file.modifiedAt.localeCompare(a.file.modifiedAt));
      if (alive) setRows(found);
    })();
    return () => {
      alive = false;
    };
  }, [store, hostId, ids]);
  const canOpen = store.canOpenPaths(hostId);
  return (
    <div className="home-simple">
      <h1 className="task-title">{t("simple.filesPage.title")}</h1>
      {rows.length === 0 ? (
        <p className="question-card-note">{t("simple.filesPage.empty")}</p>
      ) : (
        <ul aria-label={t("simple.filesPage.title")} className="task-files">
          {rows.map(({ task, file }) => (
            <li key={file.path} className="task-file">
              <span className="task-file-name">{file.name}</span>
              <span className="task-file-size">{t("simple.filesPage.from", { title: task })}</span>
              {canOpen && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={t("simple.openFile", { name: file.name })}
                    onClick={() => void store.openPath(hostId, file.path)}
                  >
                    {t("simple.open")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("simple.showInFolder", { name: file.name })}
                    onClick={() => void store.revealPath(hostId, file.path)}
                  >
                    {t("simple.showFolder")}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Simple mode for one host (phase 33): Home, a task, Files and Settings, in a narrow frame. */
export function SimpleApp(props: { store: AppStore; state: AppState; hostId: string }) {
  const { store, state, hostId } = props;
  const lang = useSyncExternalStore(store.i18n.subscribe, () => store.i18n.lang);
  const t = useMemo(() => translator(lang, "simple"), [lang]);
  const theme = useSyncExternalStore(store.theme.subscribe, () => store.theme.mode);
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [templates, setTemplates] = useState<Template[]>([]);
  const host = state.hosts.find((h) => h.id === hostId);
  const mode = store.uiMode(hostId);

  useEffect(() => {
    let alive = true;
    void store.hostRequest(hostId, "template.list", {}).then((answer) => {
      if (alive && answer.ok) setTemplates(answer.data.templates);
    });
    return () => {
      alive = false;
    };
  }, [store, hostId]);

  const tasks = useMemo(
    () =>
      [...(host?.sessions ?? [])]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((s) => ({
          sessionId: s.id,
          title: s.name ?? basename(s.cwd),
          state: STATE_OF[s.status],
        })),
    [host?.sessions],
  );

  /** The full app, with this task open when there is one: the way out for the day it is not enough. */
  const toFull = (sessionId?: string) => {
    store.setUiChoice(hostId, "full");
    if (sessionId) store.router.push({ name: "session", host: hostId, id: sessionId });
  };

  const item = (name: Screen["name"], label: string, Icon: typeof Home) => (
    <Button
      variant="ghost"
      className="simple-nav-item"
      aria-current={
        screen.name === name || (name === "home" && screen.name === "task") ? "page" : undefined
      }
      onClick={() => setScreen({ name } as Screen)}
    >
      <Icon aria-hidden="true" className="size-4" />
      {label}
    </Button>
  );

  return (
    <div className="simple-frame">
      <nav aria-label={t("simple.modeLabel")} className="simple-nav">
        {item("home", t("simple.nav.home"), Home)}
        {item("files", t("simple.nav.files"), FolderOpen)}
        {item("settings", t("simple.nav.settings"), SettingsIcon)}
      </nav>
      <main className="simple-main">
        {screen.name === "home" && (
          <HomeView
            templates={templates}
            tasks={tasks}
            t={t}
            canPickFolder={store.canPickFolder()}
            onPickFolder={() => store.pickFolder()}
            onStart={async (templateId, values) => {
              const started = await store.hostCommand(hostId, "template.start", {
                templateId,
                language: lang,
                values,
              });
              if (started) setScreen({ name: "task", sessionId: started.sessionId });
            }}
            onOpenTask={(sessionId) => setScreen({ name: "task", sessionId })}
          />
        )}
        {screen.name === "task" && (
          <TaskScreen
            store={store}
            hostId={hostId}
            sessionId={screen.sessionId}
            title={tasks.find((task) => task.sessionId === screen.sessionId)?.title ?? ""}
            locked={!mode.canSwitch}
            t={t}
            onBack={() => setScreen({ name: "home" })}
            onDetails={() => toFull(screen.sessionId)}
          />
        )}
        {screen.name === "files" && (
          <FilesScreen
            store={store}
            hostId={hostId}
            tasks={tasks.map((task) => ({ id: task.sessionId, title: task.title }))}
            t={t}
          />
        )}
        {screen.name === "settings" && (
          <SettingsView
            t={t}
            lang={lang}
            onLang={(next) => store.i18n.setLang(next)}
            theme={theme}
            onTheme={(next) => store.theme.setMode(next)}
            folders={host?.info?.allowedRoots ?? []}
            onAddFolder={(path) => store.allowRoot(hostId, path)}
            canPickFolder={store.canPickFolder()}
            onPickFolder={() => store.pickFolder()}
            notifications={state.settings.notifyUpdates}
            onNotifications={(enabled) => void store.setNotifyUpdates(enabled)}
            canSwitch={mode.canSwitch}
            onShowEverything={() => toFull()}
          />
        )}
      </main>
    </div>
  );
}
