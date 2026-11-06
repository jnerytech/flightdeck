import { Drama } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Field, NativeSelect } from "@/components/layout/form";
import { Page } from "@/components/layout/page";
import { EmptyState } from "@/components/layout/states";
import { PersonaEditor } from "@/components/personas/persona-editor";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { useStoreSlice } from "@/lib/use-store";
import type { AppStore } from "../lib/app-store.ts";
import type { AppPersona } from "../lib/global-personas.ts";
import { hasFeature } from "../lib/version.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

/** The "Projeto" choice that shows the app's own personas instead of the host's. */
const APP = "@app";

/** A pack persona the host edited is the host's own copy, still restorable to the pack's. */
const originKey = (p: AppPersona) => (p.modified ? "packEdited" : p.scope);

const PERSONASPAGE_KEYS = ["projects", "hosts"] as const;

/** Phase 20: the personas of the first online host that keeps them, of a project, and the app's. */
export const PersonasPage = memo(function PersonasPage(props: { store: AppStore }) {
  const t = useT();
  const { store } = props;
  const state = useStoreSlice(store, PERSONASPAGE_KEYS);
  const host = state.hosts.find(
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "personas", false),
  );
  const hostId = host?.id;
  const language = store.i18n.lang;
  const [project, setProject] = useState("");
  const [personas, setPersonas] = useState<AppPersona[]>([]);
  const [removing, setRemoving] = useState<AppPersona | null>(null);
  const [resetting, setResetting] = useState<AppPersona | null>(null);
  const [publishing, setPublishing] = useState<AppPersona | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<AppPersona | "new" | null>(null);
  const list = useRef<HTMLUListElement>(null);
  /** Where the person was when the editor opened: the scroll, and whose Edit button to come back to. */
  const opener = useRef<{ id: string; top: number } | null>(null);
  const keyOf = (p: AppPersona | "new") => (p === "new" ? "new" : `${p.scope}:${p.id}`);
  const scroller = () =>
    list.current?.closest<HTMLElement>("[data-slot='scroll-area-viewport']") ?? null;
  const openEditor = (p: AppPersona | "new") => {
    opener.current = { id: p === "new" ? "new" : p.id, top: scroller()?.scrollTop ?? 0 };
    setEditing(p);
  };
  // Closing the editor (Cancel or Save) puts the scroll back and the focus on the Edit button. A
  // saved pack persona changes scope, so its card is a new one: the button is looked for again
  // each time the list changes, by the persona's id.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `personas` is how a saved list asks to be looked at again
  useLayoutEffect(() => {
    if (editing !== null || !opener.current) return;
    const button = document.querySelector<HTMLElement>(`[data-edit="${opener.current.id}"]`);
    if (!button) return;
    const box = scroller();
    if (box) box.scrollTop = opener.current.top;
    opener.current = null;
    button.focus();
  }, [editing, personas]);

  useEffect(() => {
    if (hostId) void store.loadProjects(hostId);
  }, [store, hostId]);

  const reload = useCallback(async () => {
    if (project === APP) return setPersonas(store.globalPersonas.list());
    if (!hostId) return;
    const listed = await store.hostCommand(hostId, "personas.list", {
      ...(project ? { scope: "all", projectPath: project } : { scope: "host" }),
      language,
    });
    if (listed) setPersonas(listed.personas);
  }, [store, hostId, project, language]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const trust = async (p: AppPersona) => {
    if (!hostId || !p.hash) return;
    const done = await store.hostCommand(hostId, "personas.trust", {
      projectPath: project,
      id: p.id,
      hash: p.hash,
    });
    if (done) await reload();
  };

  const remove = async (p: AppPersona) => {
    setRemoving(null);
    if (p.scope === "app") store.globalPersonas.remove(p.id);
    else if (hostId && (p.scope === "host" || p.scope === "project")) {
      await store.hostCommand(hostId, "personas.remove", {
        scope: p.scope,
        id: p.id,
        ...(p.scope === "project" ? { projectPath: project } : {}),
      });
    }
    await reload();
  };

  const reset = async (p: AppPersona) => {
    if (!hostId) return;
    const done = await store.hostCommand(hostId, "personas.reset", { id: p.id, language });
    if (done) await reload();
  };

  const publish = async (p: AppPersona) => {
    setPublishing(null);
    if (!hostId || !project) return;
    const done = await store.hostCommand(hostId, "personas.publishAgent", {
      id: p.id,
      projectPath: project,
      language,
      confirm: true,
    });
    if (done) setMessage(t("personas.published", { path: done.path }));
  };

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
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
          onClose={() => setEditing(null)}
        />
      )}
      <div className="mb-4 flex flex-wrap gap-3">
        <Field label={t("personas.project")}>
          {(control) => (
            <NativeSelect {...control} value={project} onChange={(e) => setProject(e.target.value)}>
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
      {message && (
        <p role="status" className="mb-4 text-sm">
          {message}
        </p>
      )}
      {personas.length === 0 ? (
        <EmptyState icon={Drama} title={t("personas.empty")} />
      ) : (
        <ul ref={list} aria-label={t("personas.list")} className="flex flex-col gap-2">
          {personas.map((p) => (
            <li key={`${p.scope}:${p.id}`} className="flex flex-col gap-2 rounded-lg border p-3">
              {hostId && editing !== null && editing !== "new" && keyOf(editing) === keyOf(p) ? (
                <PersonaEditor
                  store={store}
                  hostId={hostId}
                  project={project === APP ? "" : project}
                  persona={p}
                  inPlace
                  onSaved={() => {
                    setEditing(null);
                    void reload();
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
                  <div className="flex flex-wrap gap-2">
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
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={t("personas.trustFor", { name: p.name })}
                        onClick={() => void trust(p)}
                      >
                        {t("personas.trust")}
                      </Button>
                    )}
                    {p.modified && (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={t("personas.resetFor", { name: p.name })}
                        onClick={() => setResetting(p)}
                      >
                        {t("personas.reset")}
                      </Button>
                    )}
                    {project && project !== APP && p.scope !== "app" && (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={t("personas.publishFor", { name: p.name })}
                        onClick={() => setPublishing(p)}
                      >
                        {t("personas.publishLabel")}
                      </Button>
                    )}
                    {p.scope !== "pack" && !p.modified && (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={t("personas.removeFor", { name: p.name })}
                        onClick={() => setRemoving(p)}
                      >
                        {t("personas.remove")}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {removing && (
        <ConfirmDialog
          message={t("personas.removeMessage", { name: removing.name })}
          confirmLabel={t("personas.remove")}
          destructive
          onConfirm={() => void remove(removing)}
          onCancel={() => setRemoving(null)}
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
        />
      )}
      {publishing && (
        <ConfirmDialog
          message={t("personas.publishMessage", { name: publishing.name, id: publishing.id })}
          confirmLabel={t("personas.publish")}
          onConfirm={() => void publish(publishing)}
          onCancel={() => setPublishing(null)}
        />
      )}
    </Page>
  );
});
