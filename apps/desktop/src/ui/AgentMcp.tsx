import type { McpLiveStatus, McpServerView } from "@flightdeck/protocol";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Form, FormActions } from "@/components/layout/form";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AppDialogContent } from "../components/feedback/dialog-content.tsx";
import type { AppStore } from "../lib/app-store.ts";
import {
  commandLine,
  draftFromServer,
  draftProblem,
  emptyDraft,
  type McpDraft,
  serverFromDraft,
} from "../lib/mcp-form.ts";
import { isInside } from "../lib/paths.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

const SELECT =
  "h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The protocol's names, which the screen shows as they are. */
/** Sessions of a managed run that can still answer `mcp.status`. */
const LIVE_SESSION = new Set(["starting", "running", "awaiting_permission", "idle"]);

const TRANSPORTS: McpDraft["transport"][] = ["stdio", "http", "sse"];

interface TestResult {
  tools: string[];
  resources: string[];
}

/** The MCP servers that apply to a project: the .mcp.json (editable) and the user's (read-only). */
export function AgentMcp(props: { store: AppStore; hostId: string; projectId: string }) {
  const { store, hostId, projectId } = props;
  const { t } = store.i18n;
  const [servers, setServers] = useState<McpServerView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<McpDraft | null>(null);
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
    if (!projects) void store.loadProjects(hostId);
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

  const toggle = async (name: string, enabled: boolean) => {
    const result = await store.hostCommand(hostId, "mcp.toggle", {
      projectId,
      name,
      enabled,
      confirm: true,
      ...(liveSessionId ? { sessionId: liveSessionId } : {}),
    });
    if (result) setServers(result.servers);
    await loadLive();
  };

  const save = async () => {
    if (!draft) return;
    const result = await store.hostCommand(hostId, "mcp.save", {
      projectId,
      server: serverFromDraft(draft),
      confirm: true,
    });
    if (result) {
      setServers(result.servers);
      setDraft(null);
    }
  };

  const remove = async (name: string) => {
    setRemoving(null);
    const result = await store.hostCommand(hostId, "mcp.remove", {
      projectId,
      name,
      confirm: true,
    });
    if (result) setServers(result.servers);
  };

  /** Step one: only what would run. Nothing starts until the user confirms it. */
  const askToTest = async (name: string) => {
    const result = await store.hostCommand(hostId, "mcp.test", { projectId, name });
    if (result && "preview" in result) {
      setConfirming({ name, line: commandLine(result.preview), url: !!result.preview.url });
    }
  };

  const runTest = async (name: string) => {
    setConfirming(null);
    setTesting(name);
    const result = await store.hostCommand(hostId, "mcp.test", {
      projectId,
      name,
      confirm: true,
    });
    setTesting(null);
    if (result && "tools" in result) setResults((all) => ({ ...all, [name]: result }));
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
  });
  const area = (key: "args" | "env" | "headers") => ({
    value: draft?.[key] ?? "",
    rows: 3,
    onChange: (e: { target: { value: string } }) =>
      setDraft((d) => (d ? { ...d, [key]: e.target.value } : d)),
  });

  return (
    <div className="flex flex-col gap-4">
      <InlineNotice>{t("agent.mcp.versioned")}</InlineNotice>
      {liveSession && (
        <p className="text-muted-foreground text-xs">
          {t("agent.mcp.live.session", { name: liveSession.name ?? liveSession.id })}
        </p>
      )}
      <div>
        <Button variant="outline" size="sm" onClick={() => setDraft(emptyDraft())}>
          <Plus aria-hidden="true" />
          {t("agent.mcp.add")}
        </Button>
      </div>
      {servers.length === 0 && <EmptyState title={t("agent.mcp.empty")} />}
      <ul aria-label={t("agent.mcp.list")} className="flex flex-col gap-2">
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
                  aria-label={t("agent.mcp.switch", { name: server.name })}
                  checked={server.enabled}
                  disabled={server.readOnly}
                  onCheckedChange={(on) => void toggle(server.name, on)}
                />
                <span className="font-medium">{server.name}</span>
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
                  disabled={testing === server.name}
                  onClick={() => void askToTest(server.name)}
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
                      onClick={() => setDraft(draftFromServer(server))}
                    >
                      {t("agent.mcp.edit", { name: server.name })}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRemoving(server.name)}>
                      {t("agent.mcp.remove", { name: server.name })}
                    </Button>
                  </>
                )}
              </div>
              <code className="break-all text-muted-foreground text-xs">{commandLine(server)}</code>
              {status?.status === "failed" && status.error && (
                <p className="text-destructive text-xs">{status.error}</p>
              )}
              {result && (
                <div className="flex flex-wrap gap-6">
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
          <Form variant="dialog" onSubmit={() => void save()}>
            <InlineNotice>{t("agent.mcp.versioned")}</InlineNotice>
            <Input
              aria-label={t("agent.mcp.name")}
              disabled={draft?.editing}
              placeholder={t("agent.mcp.name")}
              {...field("name")}
            />
            <select
              aria-label={t("agent.mcp.transport")}
              className={SELECT}
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
            </select>
            {draft?.transport === "stdio" ? (
              <>
                <Input aria-label={t("agent.mcp.command")} {...field("command")} />
                <Textarea aria-label={t("agent.mcp.args")} {...area("args")} />
                <Textarea aria-label={t("agent.mcp.env")} {...area("env")} />
              </>
            ) : (
              <>
                <Input aria-label={t("agent.mcp.url")} {...field("url")} />
                <Textarea aria-label={t("agent.mcp.headers")} {...area("headers")} />
              </>
            )}
            {problem && (
              <InlineNotice tone={problem === "retype" ? "warn" : "error"}>
                {t(`agent.mcp.${problem}`)}
              </InlineNotice>
            )}
            <FormActions
              submit={t("agent.mcp.save")}
              disabled={problem !== null}
              cancel={t("common.cancel")}
              onCancel={() => setDraft(null)}
            />
          </Form>
        </AppDialogContent>
      </Dialog>
    </div>
  );
}
