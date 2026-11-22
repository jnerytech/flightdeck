import type { SnippetFileInfo } from "@flightdeck/protocol";
import { SquareCode, Star } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { selectedClient, tagsFirst } from "@/features/clients/index.ts";
import { useT } from "@/i18n/context";
import { useStoreSlice } from "@/lib/use-store";
import { ActionButton, ConfirmDialog } from "@/shared/feedback/index.ts";
import { useMinLoading } from "@/shared/hooks/index.ts";
import {
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  NativeSelect,
  Page,
} from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import type { Route } from "../../lib/router.ts";
import { hasFeature } from "../../lib/version.ts";
import { actionSeedFromCommand } from "./domain/snippets.ts";
import { FileImport } from "./file-import.tsx";
import type { AppSnippet } from "./global-snippets.ts";
import { HistoryImport } from "./history-import.tsx";
import { SnippetEditor } from "./snippet-editor.tsx";

/** Where a snippet lives, as the row says it. */
const originOf = (snippet: AppSnippet) => (snippet.source === "file" ? "file" : snippet.scope);

/** The "Projeto" choice that shows the app's own snippets instead of the host's. */
export const GLOBAL = "@global";

const SNIPPETSPAGE_KEYS = [
  "snippetChoice",
  "projects",
  "hosts",
  "clientList",
  "clientSelection",
] as const;

/** Phase 18: the snippets of the first online host that keeps them, and of one of its projects. */
export const SnippetsPage = memo(function SnippetsPage(props: {
  store: AppStore;
  go(route: Route): void;
}) {
  const t = useT();
  const { store } = props;
  const state = useStoreSlice(store, SNIPPETSPAGE_KEYS);
  const host = state.hosts.find(
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "snippets", false),
  );
  const hostId = host?.id;
  const [project, setProject] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"" | "command" | "prompt">("");
  /** `null` until the host answers: an empty list is an answer, not the absence of one. */
  const [snippets, setSnippets] = useState<AppSnippet[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [file, setFile] = useState<SnippetFileInfo | null>(null);
  const [removing, setRemoving] = useState<AppSnippet | null>(null);
  /** The snippet whose removal the host has not answered: its Remove is busy, so a second press has nothing to send. */
  const [removingNow, setRemovingNow] = useState<string | null>(null);
  const [editing, setEditing] = useState<AppSnippet | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [importingFile, setImportingFile] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const openSettings = () => props.go({ name: "settings", section: "assistant" });
  const clearFilters = () => {
    setQuery("");
    setType("");
    searchRef.current?.focus();
  };

  useEffect(() => {
    if (hostId) void store.projectList.load(hostId);
  }, [store, hostId]);

  // Reads can overlap (a retry, a filter typed while one is out): only the latest to start is heard.
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++latest.current;
    if (project === GLOBAL) {
      setFailed(false);
      setSnippets(
        store.snippets.global.list({ ...(query ? { query } : {}), ...(type ? { type } : {}) }),
      );
      setFile(null);
      return;
    }
    if (!hostId) return;
    setFailed(false);
    const listed = await store.hostCommand(hostId, "snippets.list", {
      ...(project ? { scope: "all", projectPath: project } : { scope: "host" }),
      ...(query ? { query } : {}),
      ...(type ? { type } : {}),
    });
    if (mine !== latest.current) return;
    setFailed(!listed);
    if (!listed) return setFile(null);
    setSnippets(listed.snippets);
    setFile(listed.file);
  }, [store, hostId, project, query, type]);
  // Again when the use dialog closes: a use moves the snippet up.
  useEffect(() => {
    if (state.snippetChoice === null) void reload();
  }, [reload, state.snippetChoice]);

  const favorite = async (snippet: AppSnippet) => {
    if (snippet.scope === "global") {
      store.snippets.global.favorite(snippet.id, !snippet.favorite);
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
      store.snippets.global.remove(snippet.id);
      return reload();
    }
    if (!hostId) return;
    // Busy until the list is read again too: the row is on screen until then, and a second press
    // would remove what is already gone.
    setRemovingNow(snippet.id);
    try {
      const done = await store.hostCommand(hostId, "snippets.remove", { id: snippet.id });
      if (done !== null) await reload();
    } finally {
      setRemovingNow(null);
    }
  };

  const trust = async () => {
    if (!hostId || !file || !project) return;
    // With a device enrolled the person signs the folder and the hash in the system's dialog; a no, or a
    // failed signing, sends nothing (#3647).
    let made: Awaited<ReturnType<typeof store.approval.snippetTrustPayload>>;
    try {
      made = await store.approval.snippetTrustPayload(hostId, project, file.hash);
    } catch (error) {
      store.reportError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (made.kind === "declined") return;
    const trusted = await store.hostCommand(hostId, "snippets.trust", made.payload);
    if (trusted) await reload();
  };

  /** What the page shows: nothing while it waits or after a refusal, and no host means no snippets to wait for. */
  const cards = failed ? null : (snippets ?? (hostId || project === GLOBAL ? null : []));
  const loading = useMinLoading(!failed && cards === null);
  // The selected client's snippets (those with its tag) come first, and a new one starts with it.
  const clientTag = selectedClient(state.clientList, state.clientSelection)?.defaults.snippetTag;
  const ordered = tagsFirst(cards ?? [], clientTag);
  const projects = hostId ? (state.projects[hostId] ?? []) : [];
  // Phase 17's actions are a project's: a snippet with a secret becomes one of the chosen project.
  const actionsProject =
    project && hasFeature(host?.hostInfo?.features, "actions", false)
      ? projects.find((p) => p.path === project)
      : undefined;
  // Why the list is empty decides what it offers: a button that cannot work is never shown.
  const emptyStateFor = () => {
    if (!hostId && project !== GLOBAL) {
      return { title: t("snippets.noHost"), detail: t("snippets.noHostDetail") };
    }
    if (query || type) {
      return {
        title: t("snippets.noMatch"),
        action: (
          <Button variant="outline" onClick={clearFilters}>
            {t("snippets.clearFilters")}
          </Button>
        ),
      };
    }
    // The app's own Globals list without a host: writing a snippet still needs one.
    if (!hostId) return { title: t("snippets.empty") };
    return {
      title: t("snippets.empty"),
      action: <Button onClick={() => setEditing("new")}>{t("snippets.emptyAction")}</Button>,
    };
  };
  return (
    <Page
      title={t("snippets.title")}
      subtitle={host ? t("snippets.subtitle", { host: host.name }) : t("snippets.subtitleNoHost")}
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
          {...(clientTag ? { defaultTags: clientTag } : {})}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
          onClose={() => setEditing(null)}
          onOpenSettings={openSettings}
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
      <div className="flex flex-wrap gap-3">
        <Field label={t("snippets.project")}>
          {(control) => (
            <NativeSelect {...control} value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">{t("snippets.hostOnly")}</option>
              <option value={GLOBAL}>{t("snippets.globals")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.path}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label={t("snippets.search")}>
          {(control) => (
            <Input
              {...control}
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
        </Field>
        <Field label={t("snippets.type")}>
          {(control) => (
            <NativeSelect
              {...control}
              value={type}
              onChange={(e) => setType(e.target.value as "" | "command" | "prompt")}
            >
              <option value="">{t("snippets.all")}</option>
              <option value="command">{t("snippets.kind.command")}</option>
              <option value="prompt">{t("snippets.kind.prompt")}</option>
            </NativeSelect>
          )}
        </Field>
      </div>
      {file && (
        <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
          <p className="font-mono">{t("snippets.file.path", { path: file.path })}</p>
          <p>{file.trusted ? t("snippets.file.trusted") : t("snippets.file.untrusted")}</p>
          {!file.trusted && (
            <ActionButton size="sm" variant="outline" className="self-start" onClick={trust}>
              {t("snippets.file.trust")}
            </ActionButton>
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
      {loading && <LoadingState label={t("snippets.loading")} />}
      {failed && (
        <ErrorState
          message={t("snippets.loadFailed")}
          retryLabel={t("snippets.retry")}
          onRetry={() => {
            // A retry shows the loading shape again, so the person sees it was taken.
            setSnippets(null);
            void reload();
          }}
        />
      )}
      {cards?.length === 0 && <EmptyState icon={SquareCode} {...emptyStateFor()} />}
      {cards && cards.length > 0 && (
        <ul ref={listRef} aria-label={t("snippets.list")} className="flex flex-col gap-2">
          {ordered.map((snippet) => (
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
                <ActionButton
                  variant="outline"
                  size="sm"
                  aria-label={t(snippet.favorite ? "snippets.unfavorite" : "snippets.favorite", {
                    name: snippet.name,
                  })}
                  onClick={() => favorite(snippet)}
                >
                  <Star className={snippet.favorite ? "fill-current" : ""} aria-hidden />
                </ActionButton>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t("snippets.useFor", { name: snippet.name })}
                  onClick={() =>
                    store.snippets.choose({
                      hostId: snippet.scope === "global" ? null : (hostId ?? null),
                      snippetId: snippet.id,
                      snippet,
                    })
                  }
                >
                  {t("snippets.useSnippet")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t("snippets.editFor", { name: snippet.name })}
                  onClick={() => setEditing(snippet)}
                >
                  {t("snippets.edit")}
                </Button>
                <ActionButton
                  variant="outline"
                  size="sm"
                  aria-label={t("snippets.removeFor", { name: snippet.name })}
                  data-remove={snippet.id}
                  pending={removingNow === snippet.id}
                  onClick={() => setRemoving(snippet)}
                >
                  {t("snippets.remove")}
                </ActionButton>
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
          // A cancel goes back to the row's Remove; a confirm leaves it busy or gone, so the focus goes to a control that stays.
          onRestoreFocus={() => {
            const rows = listRef.current?.querySelectorAll<HTMLButtonElement>("[data-remove]");
            const row = Array.from(rows ?? []).find((b) => b.dataset.remove === removing.id);
            (row && !row.disabled ? row : searchRef.current)?.focus();
          }}
        />
      )}
    </Page>
  );
});
