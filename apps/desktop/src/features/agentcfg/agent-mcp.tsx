import type { McpLiveStatus, McpServerView } from "@flightdeck/protocol";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { refusalText } from "@/i18n/errors.ts";
import { AppDialogContent, ConfirmDialog, InlineNotice } from "@/shared/feedback/index.ts";
import { useBusy } from "@/shared/hooks/index.ts";
import {
  EmptyState,
  ErrorState,
  Field,
  Form,
  FormActions,
  LoadingState,
  NativeSelect,
} from "@/shared/layout/index.ts";
import { isInside } from "@/shared/lib/index.ts";
import type { AppStore, HostResult } from "../../lib/app-store.ts";
import {
  commandLine,
  draftFromServer,
  draftProblem,
  emptyDraft,
  type McpDraft,
  serverFromDraft,
} from "./domain/mcp-form.ts";

/** The protocol's names, which the screen shows as they are. */
/** Sessions of a managed run that can still answer `mcp.status`. */
const LIVE_SESSION = new Set(["starting", "running", "awaiting_permission", "idle"]);

const TRANSPORTS: McpDraft["transport"][] = ["stdio", "http", "sse"];

/** The fields of the form the person has left: a missing value is told only after that. */
type Left = Record<"name" | "command" | "url", boolean>;
const NONE_LEFT: Left = { name: false, command: false, url: false };
const ALL_LEFT: Left = { name: true, command: true, url: true };

interface TestResult {
  tools: string[];
  resources: string[];
}

/** The MCP servers that apply to a project: the .mcp.json (editable) and the user's (read-only). */
export function AgentMcp(props: Readonly<{ store: AppStore; hostId: string; projectId: string }>) {
  const { store, hostId, projectId } = props;
  const { t } = store.i18n;
  const [servers, setServers] = useState<McpServerView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<McpDraft | null>(null);
  const [left, setLeft] = useState<Left>(NONE_LEFT);
  const [formRefused, setFormRefused] = useState<string | null>(null);
  const [refused, setRefused] = useState<Record<string, string>>({});
  // After a removal, the server whose row takes the focus (null: the Add server button).
  const [focusAfter, setFocusAfter] = useState<{ name: string | null } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const saving = useBusy();
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ name: string; line: string; url: boolean } | null>(
    null,
  );
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [live, setLive] = useState<McpLiveStatus[]>([]);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const projects = state.projects[hostId];
  const projectPath = projects?.find((project) => project.id === projectId)?.path;
  const liveSession = projectPath
    ? state.hosts
        .find((host) => host.id === hostId)
        ?.sessions.find(
          (session) => LIVE_SESSION.has(session.status) && isInside(session.cwd, projectPath),
        )
    : undefined;
  const liveSessionId = liveSession?.id;

  useEffect(() => {
    if (!projects) void store.projectList.load(hostId);
  }, [store, hostId, projects]);

  const loadLive = useCallback(async () => {
    if (!liveSessionId) return setLive([]);
    const result = await store.hostCommand(hostId, "mcp.status", { sessionId: liveSessionId });
    setLive(result ? result.servers : []);
  }, [store, hostId, liveSessionId]);

  useEffect(() => {
    void loadLive();
  }, [loadLive]);

  const load = useCallback(async () => {
    setFailed(false);
    const result = await store.hostCommand(hostId, "mcp.list", { projectId });
    if (result) setServers(result.servers);
    else setFailed(true);
  }, [store, hostId, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A removed row leaves the focus on nothing: it goes to the next row, else the one before, else Add server.
  useEffect(() => {
    if (!focusAfter) return;
    const row = [...(listRef.current?.children ?? [])].find(
      (li) => li.getAttribute("aria-label") === focusAfter.name,
    );
    const control = row?.querySelector<HTMLElement>(
      'button:not([disabled]), [role="switch"]:not([disabled])',
    );
    (control ?? addRef.current)?.focus();
    setFocusAfter(null);
  }, [focusAfter]);

  /** A refusal stays in the row it came from until the next try starts. */
  const refuse = (name: string, result: Exclude<HostResult<unknown>, { ok: true }>) =>
    setRefused((all) => ({ ...all, [name]: refusalText(result.code, result.message, t, result) }));
  const clearRefusal = (name: string) => setRefused(({ [name]: _gone, ...rest }) => rest);

  const toggle = async (name: string, enabled: boolean) => {
    clearRefusal(name);
    const result = await store.hostRequest(hostId, "mcp.toggle", {
      projectId,
      name,
      enabled,
      confirm: true,
      ...(liveSessionId ? { sessionId: liveSessionId } : {}),
    });
    if (result.ok) setServers(result.data.servers);
    else refuse(name, result);
    await loadLive();
  };

  const openForm = (next: McpDraft) => {
    setLeft(NONE_LEFT);
    setFormRefused(null);
    setDraft(next);
  };

  const save = async () => {
    if (!draft) return;
    setFormRefused(null);
    const result = await store.hostRequest(hostId, "mcp.save", {
      projectId,
      server: serverFromDraft(draft),
      confirm: true,
    });
    if (result.ok) {
      setServers(result.data.servers);
      setDraft(null);
    } else {
      setFormRefused(refusalText(result.code, result.message, t, result));
    }
  };

  const remove = async (name: string) => {
    setRemoving(null);
    clearRefusal(name);
    const at = servers?.findIndex((server) => server.name === name) ?? -1;
    const neighbour = servers?.[at + 1] ?? servers?.[at - 1];
    const result = await store.hostRequest(hostId, "mcp.remove", {
      projectId,
      name,
      confirm: true,
    });
    if (result.ok) {
      setServers(result.data.servers);
      setFocusAfter({ name: neighbour?.name ?? null });
    } else {
      refuse(name, result);
    }
  };

  /** Step one: only what would run. Nothing starts until the user confirms it. */
  const askToTest = async (name: string) => {
    clearRefusal(name);
    const result = await store.hostRequest(hostId, "mcp.test", { projectId, name });
    if (!result.ok) return refuse(name, result);
    if ("preview" in result.data) {
      setConfirming({
        name,
        line: commandLine(result.data.preview),
        url: !!result.data.preview.url,
      });
    }
  };

  const runTest = async (name: string) => {
    setConfirming(null);
    setTesting(name);
    clearRefusal(name);
    const result = await store.hostRequest(hostId, "mcp.test", {
      projectId,
      name,
      confirm: true,
    });
    setTesting(null);
    if (!result.ok) return refuse(name, result);
    const tested = result.data;
    if ("tools" in tested) setResults((all) => ({ ...all, [name]: tested }));
  };

  const origin = (server: McpServerView) => {
    if (server.origin === "project") return t("agent.originProject");
    return server.origin === "user" ? t("agent.originUserMcp") : t("agent.originUserProject");
  };

  if (failed) {
    return (
      <ErrorState message={t("agent.loadFailed")} retryLabel={t("agent.retry")} onRetry={load} />
    );
  }
  if (servers === null) return <LoadingState label={t("agent.loading")} />;

  const problem = draft ? draftProblem(draft) : null;
  const field = (key: "name" | "command" | "url") => ({
    value: draft?.[key] ?? "",
    onChange: (e: { target: { value: string } }) =>
      setDraft((d) => (d ? { ...d, [key]: e.target.value } : d)),
    onBlur: () => setLeft((all) => ({ ...all, [key]: true })),
  });
  // What is missing is told once its field was left (Save is disabled, so Enter cannot submit an invalid form); until then Save's reason says it quietly.
  const missing = (key: keyof Left, need: "needName" | "needCommand" | "needUrl") =>
    left[key] && problem === need ? t(`agent.mcp.${need}`) : undefined;
  const missingText =
    missing("name", "needName") ?? missing("command", "needCommand") ?? missing("url", "needUrl");
  const area = (key: "args" | "env" | "headers") => ({
    value: draft?.[key] ?? "",
    rows: 3,
    onChange: (e: { target: { value: string } }) =>
      setDraft((d) => (d ? { ...d, [key]: e.target.value } : d)),
  });

  return (
    <div className="flex flex-col gap-4">
      <InlineNotice>{t("agent.mcp.versioned")}</InlineNotice>
      {liveSession && live.length > 0 && (
        <p className="text-muted-foreground text-xs">
          {t("agent.mcp.live.session", { name: liveSession.name ?? liveSession.id })}
        </p>
      )}
      <div>
        <Button ref={addRef} variant="outline" size="sm" onClick={() => openForm(emptyDraft())}>
          <Plus aria-hidden="true" />
          {t("agent.mcp.add")}
        </Button>
      </div>
      {servers.length === 0 && <EmptyState title={t("agent.mcp.empty")} />}
      {servers.length > 0 && (
        <ul ref={listRef} aria-label={t("agent.mcp.list")} className="flex flex-col gap-2">
          {servers.map((server) => {
            const result = results[server.name];
            const status = live.find((entry) => entry.name === server.name);
            return (
              <li
                key={`${server.origin}/${server.name}`}
                aria-label={server.name}
                className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Switch
                    size="sm"
                    className="hit-switch"
                    aria-label={server.name}
                    checked={server.enabled}
                    disabled={server.readOnly}
                    onCheckedChange={(on) => void toggle(server.name, on)}
                  />
                  <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
                    {server.name}
                  </span>
                  <Badge variant="outline">{server.transport}</Badge>
                  <Badge variant="secondary">{origin(server)}</Badge>
                  {server.readOnly && <Badge variant="outline">{t("agent.readOnly")}</Badge>}
                  {status && (
                    <Badge variant={status.status === "failed" ? "destructive" : "outline"}>
                      {t(`agent.mcp.live.${status.status}`)}
                    </Badge>
                  )}
                  <span className="flex-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-disabled={testing === server.name || undefined}
                    aria-busy={testing === server.name || undefined}
                    onClick={() => testing !== server.name && void askToTest(server.name)}
                  >
                    {testing === server.name
                      ? t("agent.mcp.testing", { name: server.name })
                      : t("agent.mcp.test", { name: server.name })}
                  </Button>
                  {!server.readOnly && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openForm(draftFromServer(server))}
                      >
                        {t("agent.mcp.edit", { name: server.name })}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(server.name)}>
                        {t("agent.mcp.remove", { name: server.name })}
                      </Button>
                    </>
                  )}
                </div>
                <code className="break-all text-muted-foreground text-xs">
                  {commandLine(server)}
                </code>
                {status?.status === "failed" && status.error && (
                  <p role="alert" className="text-destructive text-xs">
                    {status.error}
                  </p>
                )}
                {refused[server.name] && (
                  <p role="alert" className="text-destructive text-xs">
                    {refused[server.name]}
                  </p>
                )}
                {result && (
                  <div // NOSONAR: <output> allows only inline content, and this result holds headings and blocks
                    role="status" // NOSONAR: same reason
                    className="flex flex-wrap gap-6"
                  >
                    {(["tools", "resources"] as const).map((kind) => (
                      <div key={kind}>
                        <h4 className="font-medium text-xs">
                          {t(kind === "tools" ? "agent.mcp.tools" : "agent.mcp.resources", {
                            name: server.name,
                          })}
                        </h4>
                        <p className="text-muted-foreground text-xs">
                          {result[kind].length > 0 ? result[kind].join(", ") : t("agent.mcp.none")}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {confirming && (
        <ConfirmDialog
          message={t(confirming.url ? "agent.mcp.testUrl" : "agent.mcp.testCommand", {
            command: confirming.line,
            url: confirming.line,
          })}
          confirmLabel={t("agent.mcp.testRun")}
          onConfirm={() => void runTest(confirming.name)}
          onCancel={() => setConfirming(null)}
        />
      )}
      {removing && (
        <ConfirmDialog
          message={t("agent.mcp.removeMessage", { name: removing })}
          confirmLabel={t("agent.mcp.removeConfirm")}
          destructive
          onConfirm={() => void remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <AppDialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {draft?.editing
                ? t("agent.mcp.formEdit", { name: draft.name })
                : t("agent.mcp.formNew")}
            </DialogTitle>
          </DialogHeader>
          <Form
            variant="dialog"
            onSubmit={() => {
              setLeft(ALL_LEFT);
              if (problem === null) saving.run(save);
            }}
          >
            <InlineNotice>{t("agent.mcp.versioned")}</InlineNotice>
            <Field label={t("agent.mcp.name")} error={missing("name", "needName")}>
              {(control) => <Input {...control} disabled={draft?.editing} {...field("name")} />}
            </Field>
            <Field label={t("agent.mcp.transport")}>
              {(control) => (
                <NativeSelect
                  {...control}
                  value={draft?.transport ?? "stdio"}
                  onChange={(e) =>
                    setDraft((d) =>
                      d ? { ...d, transport: e.target.value as McpDraft["transport"] } : d,
                    )
                  }
                >
                  {TRANSPORTS.map((transport) => (
                    <option key={transport} value={transport}>
                      {transport}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            {draft?.transport === "stdio" ? (
              <>
                <Field label={t("agent.mcp.command")} error={missing("command", "needCommand")}>
                  {(control) => <Input {...control} {...field("command")} />}
                </Field>
                <Field label={t("agent.mcp.args")}>
                  {(control) => <Textarea {...control} {...area("args")} />}
                </Field>
                <Field label={t("agent.mcp.env")}>
                  {(control) => <Textarea {...control} {...area("env")} />}
                </Field>
              </>
            ) : (
              <>
                <Field label={t("agent.mcp.url")} error={missing("url", "needUrl")}>
                  {(control) => <Input {...control} {...field("url")} />}
                </Field>
                <Field label={t("agent.mcp.headers")}>
                  {(control) => <Textarea {...control} {...area("headers")} />}
                </Field>
              </>
            )}
            {problem === "retype" && <InlineNotice>{t("agent.mcp.retype")}</InlineNotice>}
            {formRefused && <InlineNotice tone="error">{formRefused}</InlineNotice>}
            <FormActions
              submit={t("agent.mcp.save")}
              busy={saving.busy}
              disabled={problem !== null}
              disabledReason={
                problem && problem !== "retype" && !missingText
                  ? t(`agent.mcp.${problem}`)
                  : undefined
              }
              cancel={t("common.cancel")}
              onCancel={() => setDraft(null)}
            />
          </Form>
        </AppDialogContent>
      </Dialog>
    </div>
  );
}
