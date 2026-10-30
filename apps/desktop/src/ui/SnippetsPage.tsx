import type { SnippetFileInfo } from "@flightdeck/protocol";
import { SquareCode, Star } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Page } from "@/components/layout/page";
import { EmptyState } from "@/components/layout/states";
import { FileImport } from "@/components/snippets/file-import";
import { HistoryImport } from "@/components/snippets/history-import";
import { SnippetEditor } from "@/components/snippets/snippet-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { AppState, AppStore } from "../lib/app-store.ts";
import type { AppSnippet } from "../lib/global-snippets.ts";
import type { Route } from "../lib/router.ts";
import { actionSeedFromCommand } from "../lib/snippets.ts";
import { hasFeature } from "../lib/version.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

const SELECT = "h-9 rounded-md border bg-transparent px-2";

/** Where a snippet lives, as the row says it. */
const originOf = (snippet: AppSnippet) => (snippet.source === "file" ? "file" : snippet.scope);

/** The "Projeto" choice that shows the app's own snippets instead of the host's. */
export const GLOBAL = "@global";

/** Phase 18: the snippets of the first online host that keeps them, and of one of its projects. */
export function SnippetsPage(props: { store: AppStore; state: AppState; go(route: Route): void }) {
  const t = useT();
  const { store, state } = props;
  const host = state.hosts.find(
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "snippets", false),
  );
  const hostId = host?.id;
  const [project, setProject] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"" | "command" | "prompt">("");
  const [snippets, setSnippets] = useState<AppSnippet[]>([]);
  const [file, setFile] = useState<SnippetFileInfo | null>(null);
  const [removing, setRemoving] = useState<AppSnippet | null>(null);
  const [editing, setEditing] = useState<AppSnippet | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [importingFile, setImportingFile] = useState(false);

  useEffect(() => {
    if (hostId) void store.loadProjects(hostId);
  }, [store, hostId]);

  const reload = useCallback(async () => {
    if (project === GLOBAL) {
      setSnippets(
        store.globalSnippets.list({ ...(query ? { query } : {}), ...(type ? { type } : {}) }),
      );
      setFile(null);
      return;
    }
    if (!hostId) return;
    const listed = await store.hostCommand(hostId, "snippets.list", {
      ...(project ? { scope: "all", projectPath: project } : { scope: "host" }),
      ...(query ? { query } : {}),
      ...(type ? { type } : {}),
    });
    if (!listed) return;
    setSnippets(listed.snippets);
    setFile(listed.file);
  }, [store, hostId, project, query, type]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const favorite = async (snippet: AppSnippet) => {
    if (snippet.scope === "global") {
      store.globalSnippets.favorite(snippet.id, !snippet.favorite);
      return reload();
    }
    if (!hostId) return;
    const done = await store.hostCommand(hostId, "snippets.favorite", {
      id: snippet.id,
      favorite: !snippet.favorite,
    });
    if (done) await reload();
  };

  const remove = async (snippet: AppSnippet) => {
    setRemoving(null);
    if (snippet.scope === "global") {
      store.globalSnippets.remove(snippet.id);
      return reload();
    }
    if (!hostId) return;
    const done = await store.hostCommand(hostId, "snippets.remove", { id: snippet.id });
    if (done !== null) await reload();
  };

  const trust = async () => {
    if (!hostId || !file || !project) return;
    const trusted = await store.hostCommand(hostId, "snippets.trust", {
      projectPath: project,
      hash: file.hash,
    });
    if (trusted) await reload();
  };

  const projects = hostId ? (state.projects[hostId] ?? []) : [];
  // Phase 17's actions are a project's: a snippet with a secret becomes one of the chosen project.
  const actionsProject =
    project && hasFeature(host?.hostInfo?.features, "actions", false)
      ? projects.find((p) => p.path === project)
      : undefined;
  return (
    <Page
      title={t("snippets.title")}
      subtitle={t("snippets.subtitle", { host: host?.name ?? "" })}
      actions={
        hostId &&
        editing === null && (
          <>
            <Button variant="outline" onClick={() => setImporting(!importing)}>
              {t("snippets.history.open")}
            </Button>
            <Button variant="outline" onClick={() => setImportingFile(!importingFile)}>
              {t("snippets.file.open")}
            </Button>
            <Button onClick={() => setEditing("new")}>{t("snippets.newSnippet")}</Button>
          </>
        )
      }
    >
      {hostId && importingFile && (
        <FileImport store={store} hostId={hostId} onImported={() => void reload()} />
      )}
      {hostId && importing && (
        <HistoryImport store={store} hostId={hostId} onImported={() => void reload()} />
      )}
      {hostId && editing !== null && (
        <SnippetEditor
          key={editing === "new" ? "new" : editing.id}
          store={store}
          hostId={hostId}
          project={project === GLOBAL ? "" : project}
          snippet={editing === "new" ? null : editing}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
          onClose={() => setEditing(null)}
          {...(actionsProject && hostId
            ? {
                onMakeAction: ({ name, command }: { name: string; command: string }) =>
                  props.go({
                    name: "actions",
                    host: hostId,
                    projectId: actionsProject.id,
                    projectName: actionsProject.name,
                    draft: actionSeedFromCommand(name, command),
                  }),
              }
            : {})}
        />
      )}
      <div className="mb-4 flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t("snippets.project")}
          <select className={SELECT} value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">{t("snippets.hostOnly")}</option>
            <option value={GLOBAL}>{t("snippets.globals")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.path}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="snippets-search">{t("snippets.search")}</label>
          <Input id="snippets-search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <label className="flex flex-col gap-1 text-sm">
          {t("snippets.type")}
          <select
            className={SELECT}
            value={type}
            onChange={(e) => setType(e.target.value as "" | "command" | "prompt")}
          >
            <option value="">{t("snippets.all")}</option>
            <option value="command">{t("snippets.kind.command")}</option>
            <option value="prompt">{t("snippets.kind.prompt")}</option>
          </select>
        </label>
      </div>
      {file && (
        <div className="mb-4 flex flex-col gap-2 rounded-lg border p-3 text-sm">
          <p className="font-mono">{t("snippets.file.path", { path: file.path })}</p>
          <p>{file.trusted ? t("snippets.file.trusted") : t("snippets.file.untrusted")}</p>
          {!file.trusted && (
            <Button size="sm" variant="outline" className="self-start" onClick={() => void trust()}>
              {t("snippets.file.trust")}
            </Button>
          )}
          {file.errors.length > 0 && (
            <ul aria-label={t("snippets.file.errors")} className="list-disc pl-5 text-destructive">
              {file.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {snippets.length === 0 ? (
        <EmptyState icon={SquareCode} title={t("snippets.empty")} />
      ) : (
        <ul aria-label={t("snippets.list")} className="flex flex-col gap-2">
          {snippets.map((snippet) => (
            <li key={snippet.id} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span data-name className="font-medium">
                  {snippet.name}
                </span>
                <span className="text-muted-foreground text-sm">
                  {t(`snippets.kind.${snippet.type}`)}
                </span>
                <span className="rounded bg-muted px-1.5 text-xs">
                  {t(`snippets.origin.${originOf(snippet)}`)}
                </span>
                {snippet.tags.map((tag) => (
                  <span key={tag} className="rounded bg-muted px-1.5 text-xs">
                    {tag}
                  </span>
                ))}
              </div>
              <p className="break-all font-mono text-muted-foreground text-sm">
                {snippet.run ?? snippet.text}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t(snippet.favorite ? "snippets.unfavorite" : "snippets.favorite", {
                    name: snippet.name,
                  })}
                  onClick={() => void favorite(snippet)}
                >
                  <Star className={snippet.favorite ? "fill-current" : ""} aria-hidden />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t("snippets.editFor", { name: snippet.name })}
                  onClick={() => setEditing(snippet)}
                >
                  {t("snippets.edit")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t("snippets.removeFor", { name: snippet.name })}
                  onClick={() => setRemoving(snippet)}
                >
                  {t("snippets.remove")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {removing && (
        <ConfirmDialog
          message={t("snippets.removeMessage", { name: removing.name })}
          confirmLabel={t("snippets.remove")}
          destructive
          onConfirm={() => void remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </Page>
  );
}
