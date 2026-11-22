import { Drama } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { refusalText } from "@/i18n/errors.ts";
import { useStoreSlice } from "@/lib/use-store";
import { ActionButton, ConfirmDialog, InlineNotice } from "@/shared/feedback/index.ts";
import { useMinLoading } from "@/shared/hooks/index.ts";
import {
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  NativeSelect,
  Page,
} from "@/shared/layout/index.ts";
import type { AppStore, HostResult } from "../../lib/app-store.ts";
import type { Route } from "../../lib/router.ts";
import { hasFeature } from "../../lib/version.ts";
import type { AppPersona } from "./domain/global-personas.ts";
import { PersonaEditor } from "./persona-editor.tsx";

/** The "Projeto" choice that shows the app's own personas instead of the host's. */
const APP = "@app";

/** A pack persona the host edited is the host's own copy, still restorable to the pack's. */
const originKey = (p: AppPersona) => (p.modified ? "packEdited" : p.scope);

const PERSONASPAGE_KEYS = ["projects", "hosts"] as const;

type Action = "trust" | "remove" | "reset" | "publish";

/** Phase 20: the personas of the first online host that keeps them, of a project, and the app's. */
export const PersonasPage = memo(function PersonasPage(props: {
  store: AppStore;
  go(route: Route): void;
}) {
  const t = useT();
  const { store } = props;
  const openSettings = () => props.go({ name: "settings", section: "assistant" });
  const state = useStoreSlice(store, PERSONASPAGE_KEYS);
  const host = state.hosts.find(
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "personas", false),
  );
  const hostId = host?.id;
  const language = store.i18n.lang;
  const [project, setProject] = useState("");
  /** `null` until the host answers: an empty list is an answer, not the absence of one. */
  const [personas, setPersonas] = useState<AppPersona[] | null>(null);
  const [failed, setFailed] = useState(false);
  /** What the page shows: nothing while it waits or after a refusal, and no host means no personas to wait for. */
  const waitedFor = hostId ? null : [];
  const cards = failed ? null : (personas ?? waitedFor);
  const loading = useMinLoading(!failed && cards === null);
  const [removing, setRemoving] = useState<AppPersona | null>(null);
  const [resetting, setResetting] = useState<AppPersona | null>(null);
  const [publishing, setPublishing] = useState<AppPersona | null>(null);
  /** The action the host has not answered yet: one at a time, so a second press has nothing to send. */
  const [pending, setPending] = useState<{ id: string; action: Action } | null>(null);
  const running = useRef(false);
  /** What the last action came to, said on the page: a refusal, or where a publish went. */
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  /** Counts the project or host changes, so an answer that arrives after one says nothing. */
  const view = useRef(0);
  const [editing, setEditing] = useState<AppPersona | "new" | null>(null);
  const list = useRef<HTMLUListElement>(null);
  /** Where the person was when the editor opened: the scroll, and whose Edit button to come back to. */
  const opener = useRef<{ id: string; top: number } | null>(null);
  const keyOf = (p: AppPersona | "new") => (p === "new" ? "new" : `${p.scope}:${p.id}`);
  /** The Edit button of a persona, or `new` for New persona: the controls that stay on while an action runs. */
  const editButton = (id: string) => document.querySelector<HTMLElement>(`[data-edit="${id}"]`);
  const scroller = () =>
    list.current?.closest<HTMLElement>("[data-slot='scroll-area-viewport']") ?? null;
  const openEditor = (p: AppPersona | "new") => {
    opener.current = { id: p === "new" ? "new" : p.id, top: scroller()?.scrollTop ?? 0 };
    setEditing(p);
  };
  // Closing the editor (Cancel or Save) puts the scroll back and the focus on the Edit button. A
  // saved pack persona changes scope, so its card is a new one: Save reloads the list before it
  // closes the editor, so the button that gets the focus is the one that stays (#854).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `personas` is how a saved list asks to be looked at again
  useLayoutEffect(() => {
    if (editing !== null || !opener.current) return;
    const button = editButton(opener.current.id);
    if (!button) return;
    const box = scroller();
    if (box) box.scrollTop = opener.current.top;
    opener.current = null;
    button.focus();
  }, [editing, personas]);

  useEffect(() => {
    if (hostId) void store.projectList.load(hostId);
  }, [store, hostId]);

  // Another project or host is another list: the last one's cards go, so none is acted on under the wrong project.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the reset is for a new project or host, nothing else
  useEffect(() => {
    setPersonas(null);
    setFailed(false);
    setNotice(null);
    view.current++;
  }, [project, hostId]);
  // Reads can overlap (a retry, a project picked while one is out): only the latest to start is heard.
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++latest.current;
    if (project === APP) {
      setFailed(false);
      return setPersonas(store.personas.global.list());
    }
    if (!hostId) return;
    setFailed(false);
    const listed = await store.hostCommand(hostId, "personas.list", {
      ...(project ? { scope: "all", projectPath: project } : { scope: "host" }),
      language,
    });
    if (mine !== latest.current) return;
    setFailed(!listed);
    if (listed) setPersonas(listed.personas);
  }, [store, hostId, project, language]);
  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Runs one action on a persona: the page's buttons are busy until the host answers, a refusal is
   * said on the page with the persona's name, and a second press while one runs sends nothing.
   */
  const act = async <R,>(
    p: AppPersona,
    action: Action,
    request: () => Promise<HostResult<R>>,
    onDone: (data: R) => Promise<void> | string,
  ) => {
    if (running.current) return;
    running.current = true;
    const seen = view.current;
    setNotice(null);
    setPending({ id: keyOf(p), action });
    try {
      const result = await request();
      if (!result.ok) {
        const reason = refusalText(result.code, result.message, t, result);
        setNotice({ tone: "error", text: t("personas.actionFailed", { name: p.name, reason }) });
        return;
      }
      // The person moved to another project or host meanwhile: what this answer says is not about the list they see.
      if (seen !== view.current) return;
      const done = onDone(result.data);
      if (typeof done === "string") setNotice({ tone: "info", text: done });
      else await done;
    } finally {
      running.current = false;
      setPending(null);
    }
  };

  const trust = async (p: AppPersona) => {
    if (!hostId || !p.hash) return;
    // The Trust button turns off while the host answers, and a trusted card loses it: the Edit button stays.
    editButton(p.id)?.focus();
    await act(
      p,
      "trust",
      () =>
        store.hostRequest(hostId, "personas.trust", {
          projectPath: project,
          id: p.id,
          hash: p.hash as string,
        }),
      reload,
    );
  };

  const remove = async (p: AppPersona) => {
    setRemoving(null);
    if (p.scope === "app") {
      setNotice(null);
      store.personas.global.remove(p.id);
      return reload();
    }
    const { scope } = p;
    if (!hostId || (scope !== "host" && scope !== "project")) return;
    await act(
      p,
      "remove",
      () =>
        store.hostRequest(hostId, "personas.remove", {
          scope,
          id: p.id,
          ...(scope === "project" ? { projectPath: project } : {}),
        }),
      reload,
    );
  };

  const reset = async (p: AppPersona) => {
    if (!hostId) return;
    await act(
      p,
      "reset",
      () => store.hostRequest(hostId, "personas.reset", { id: p.id, language }),
      reload,
    );
  };

  const publish = async (p: AppPersona) => {
    setPublishing(null);
    if (!hostId || !project) return;
    await act(
      p,
      "publish",
      () =>
        store.hostRequest(hostId, "personas.publishAgent", {
          id: p.id,
          projectPath: project,
          language,
          confirm: true,
        }),
      (done) => t("personas.published", { name: p.name, path: done.path }),
    );
  };

  /** Whether this action of this persona is the one in flight; every button is off while any is. */
  const busy = (p: AppPersona, action: Action) =>
    pending?.id === keyOf(p) && pending.action === action;

  const projects = hostId ? (state.projects[hostId] ?? []) : [];
  return (
    <Page
      title={t("personas.title")}
      subtitle={t("personas.subtitle", { host: host?.name ?? "" })}
      actions={
        hostId &&
        editing === null && (
          <Button data-edit="new" onClick={() => openEditor("new")}>
            {t("personas.newPersona")}
          </Button>
        )
      }
    >
      {hostId && editing === "new" && (
        <PersonaEditor
          key="new"
          store={store}
          hostId={hostId}
          project={project === APP ? "" : project}
          persona={null}
          onOpenSettings={openSettings}
          onSaved={async () => {
            await reload();
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
      <div className="flex flex-wrap gap-3">
        {/* Off while an editor is open: another project is another list, and the editor's typed text would go with it (#4212). */}
        <Field
          label={t("personas.project")}
          help={editing === null ? undefined : t("personas.projectLocked")}
        >
          {(control) => (
            <NativeSelect
              {...control}
              value={project}
              disabled={editing !== null}
              onChange={(e) => setProject(e.target.value)}
            >
              <option value="">{t("personas.hostOnly")}</option>
              <option value={APP}>{t("personas.globals")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.path}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>
      {notice && <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>}
      {loading && <LoadingState label={t("personas.loading")} />}
      {failed && (
        <ErrorState
          message={t("personas.loadFailed")}
          retryLabel={t("personas.retry")}
          onRetry={() => {
            // A retry shows the loading shape again, so the person sees it was taken.
            setPersonas(null);
            void reload();
          }}
        />
      )}
      {cards?.length === 0 && <EmptyState icon={Drama} title={t("personas.empty")} />}
      {cards && cards.length > 0 && (
        <ul ref={list} aria-label={t("personas.list")} className="flex flex-col gap-2">
          {cards.map((p) => {
            const inEditor =
              hostId && editing !== null && editing !== "new" && keyOf(editing) === keyOf(p);
            return (
              // A row puts its actions beside its text; the one being edited is a full-width card (#588).
              <li
                key={`${p.scope}:${p.id}`}
                data-slot={inEditor ? "persona-card" : "persona-row"}
                className={inEditor ? "persona-card" : "persona-row"}
              >
                {inEditor ? (
                  <PersonaEditor
                    store={store}
                    hostId={hostId}
                    project={project === APP ? "" : project}
                    persona={p}
                    onOpenSettings={openSettings}
                    onSaved={async () => {
                      await reload();
                      setEditing(null);
                    }}
                    onClose={() => setEditing(null)}
                  />
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span data-name className="font-medium">
                        {p.name}
                      </span>
                      <span className="rounded bg-muted px-1.5 text-xs">
                        {t(`personas.origin.${originKey(p)}`)}
                      </span>
                      {!p.trusted && (
                        <span className="rounded bg-destructive/10 px-1.5 text-destructive text-xs">
                          {t("personas.untrusted")}
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground text-sm">{p.description}</p>
                    <div data-slot="persona-actions" className="persona-actions">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={t("personas.editFor", { name: p.name })}
                        data-edit={p.id}
                        onClick={() => openEditor(p)}
                      >
                        {t("personas.edit")}
                      </Button>
                      {!p.trusted && (
                        <ActionButton
                          size="sm"
                          variant="outline"
                          aria-label={t("personas.trustFor", { name: p.name })}
                          pending={busy(p, "trust")}
                          disabled={pending !== null}
                          onClick={() => trust(p)}
                        >
                          {t("personas.trust")}
                        </ActionButton>
                      )}
                      {p.modified && (
                        <ActionButton
                          size="sm"
                          variant="outline"
                          aria-label={t("personas.resetFor", { name: p.name })}
                          pending={busy(p, "reset")}
                          disabled={pending !== null}
                          onClick={() => setResetting(p)}
                        >
                          {t("personas.reset")}
                        </ActionButton>
                      )}
                      {project && project !== APP && p.scope !== "app" && (
                        <ActionButton
                          size="sm"
                          variant="outline"
                          aria-label={t("personas.publishFor", { name: p.name })}
                          pending={busy(p, "publish")}
                          disabled={pending !== null}
                          onClick={() => setPublishing(p)}
                        >
                          {t("personas.publishLabel")}
                        </ActionButton>
                      )}
                      {p.scope !== "pack" && !p.modified && (
                        <ActionButton
                          size="sm"
                          variant="outline"
                          aria-label={t("personas.removeFor", { name: p.name })}
                          pending={busy(p, "remove")}
                          disabled={pending !== null}
                          onClick={() => setRemoving(p)}
                        >
                          {t("personas.remove")}
                        </ActionButton>
                      )}
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {removing && (
        <ConfirmDialog
          message={t("personas.removeMessage", { name: removing.name })}
          confirmLabel={t("personas.remove")}
          destructive
          onConfirm={() => void remove(removing)}
          onCancel={() => setRemoving(null)}
          // The removed card is gone after the host answers: the focus goes to a control that stays.
          onRestoreFocus={() => editButton("new")?.focus()}
        />
      )}
      {resetting && (
        <ConfirmDialog
          message={t("personas.resetMessage", { name: resetting.name })}
          confirmLabel={t("personas.reset")}
          destructive
          onConfirm={() => {
            setResetting(null);
            void reset(resetting);
          }}
          onCancel={() => setResetting(null)}
          onRestoreFocus={() => editButton(resetting.id)?.focus()}
        />
      )}
      {publishing && (
        <ConfirmDialog
          message={t("personas.publishMessage", { name: publishing.name, id: publishing.id })}
          confirmLabel={t("personas.publish")}
          onConfirm={() => void publish(publishing)}
          onCancel={() => setPublishing(null)}
          onRestoreFocus={() => editButton(publishing.id)?.focus()}
        />
      )}
    </Page>
  );
});
