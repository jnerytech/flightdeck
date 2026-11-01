import type { BoardColumn, Project, ProjectListResult, PrProviderKind } from "@flightdeck/protocol";
import { FolderGit2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { NativeSelect } from "@/components/layout/form";
import { Page } from "@/components/layout/page";
import { Panel } from "@/components/layout/panel";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { PersonaPicker } from "@/components/personas/persona-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMinLoading } from "@/hooks/use-min-loading";
import type { AppStore } from "../lib/app-store.ts";
import { hasFeature } from "../lib/version.ts";
import { FolderPicker } from "./FolderPicker.tsx";
import { RulesSection } from "./RulesSection.tsx";
import { TerminalButton } from "./TerminalButton.tsx";

/** What a `.worktreeinclude` looks like: patterns in the format of `.gitignore`. */
const WORKTREE_INCLUDE_EXAMPLE = [".env", ".env.local", "config/*.secret.json"].join("\n");

interface Draft {
  path: string;
  name: string;
  baseBranch: string;
  prProvider: PrProviderKind;
  setupScript: string;
  promptTemplate: string;
  /** Phase 20: the default persona of each column, a plain id or "". */
  personaByColumn: Partial<Record<BoardColumn, string>>;
}

const COLUMNS: BoardColumn[] = ["backlog", "in_progress", "waiting", "review", "done"];

const EMPTY: Draft = {
  path: "",
  name: "",
  baseBranch: "",
  prProvider: "none",
  setupScript: "",
  promptTemplate: "",
  personaByColumn: {},
};

const fromProject = (p: Project): Draft => ({
  path: p.path,
  name: p.name,
  baseBranch: p.baseBranch,
  prProvider: p.prProvider,
  setupScript: p.setupScript ?? "",
  promptTemplate: p.promptTemplate,
  personaByColumn: p.personaByColumn,
});

/** Projects of one host (register and edit) and the host's limit of parallel runs. */
export function ProjectsPage(props: {
  store: AppStore;
  hostId: string;
  hostName: string;
  onOpenBoard(projectId: string): void;
  onOpenWorkflows(project: { id: string; name: string }): void;
  /** The host announces `automation` (phase 13): each project's Automações. */
  automations: boolean;
  onOpenAutomations(project: { id: string; name: string }): void;
  /** The host announces `actions` (phase 17): each project's Ações. */
  actions: boolean;
  onOpenActions(project: { id: string; name: string }): void;
  /** The host announces `rules`: the project's Regras section. */
  rules: boolean;
  /** The host announces `agentcfg` (phase 12): the project's Agente screen. */
  agent: boolean;
  /** The host announces `personas` (phase 20): a default persona per board column. */
  personas?: boolean;
  onOpenAgent(project: { id: string; name: string }): void;
  /** Only the picker for Board or Workflows (a nav item with several projects). */
  focus?: "board" | "workflows";
}) {
  const { store, hostId } = props;
  const [list, setList] = useState<ProjectListResult | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [limit, setLimit] = useState("");
  const loading = useMinLoading(list === null);
  const { t } = props.store.i18n;
  const pathField = useRef<HTMLInputElement>(null);
  const [browsing, setBrowsing] = useState(false);
  const host = store.getState().hosts.find((h) => h.id === hostId);

  const reload = useCallback(async () => {
    const result = await store.hostCommand(hostId, "project.list", {});
    if (result) {
      setList(result);
      setLimit(String(result.maxParallelRuns));
    }
  }, [store, hostId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submit = async () => {
    // Blank name and base branch keep the daemon's defaults (folder name, current branch).
    const fields = {
      ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
      ...(draft.baseBranch.trim() ? { baseBranch: draft.baseBranch.trim() } : {}),
      prProvider: draft.prProvider,
      setupScript: draft.setupScript,
    };
    const saved = editing
      ? await store.hostCommand(hostId, "project.update", {
          projectId: editing,
          ...fields,
          promptTemplate: draft.promptTemplate,
          ...(props.personas && {
            // An emptied column takes its default away.
            personaByColumn: Object.fromEntries(
              COLUMNS.map((column) => [column, draft.personaByColumn[column] || null]),
            ),
          }),
        })
      : await store.hostCommand(hostId, "project.add", {
          path: draft.path,
          ...fields,
          // Blank keeps the default template.
          ...(draft.promptTemplate.trim() ? { promptTemplate: draft.promptTemplate } : {}),
        });
    if (saved) {
      setEditing(null);
      setDraft(EMPTY);
      await reload();
    }
  };

  const field = (key: Exclude<keyof Draft, "personaByColumn">) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value }),
  });

  if (props.focus) {
    const board = props.focus === "board";
    return (
      <Page title={t(board ? "sidebar.boardOf" : "sidebar.workflowsOf", { host: props.hostName })}>
        {loading && <LoadingState label={t("states.loadingProjects")} />}
        {!loading && list?.projects.length === 0 && (
          <EmptyState title={t("states.emptyProjects")} />
        )}
        <ul aria-label={t("projectsUi.list")} className="flex flex-col">
          {(list?.projects ?? []).map((project) => (
            <li key={project.id} className="flex items-center gap-3">
              <Button
                variant="ghost"
                onClick={() =>
                  board ? props.onOpenBoard(project.id) : props.onOpenWorkflows(project)
                }
              >
                {board
                  ? t("projectsUi.openBoard", { name: project.name })
                  : t("projectsUi.workflows", { name: project.name })}
              </Button>
              <span className="text-muted-foreground text-xs">{`${project.path} · ${project.baseBranch}`}</span>
            </li>
          ))}
        </ul>
      </Page>
    );
  }

  return (
    <Page title={t("projectsUi.title", { host: props.hostName })}>
      <div className="flex max-w-3xl flex-col gap-6">
        {loading && <LoadingState label={t("states.loadingProjects")} />}
        {!loading && list?.projects.length === 0 && (
          <EmptyState
            icon={FolderGit2}
            title={t("states.emptyProjects")}
            action={
              <Button onClick={() => pathField.current?.focus()}>{t("states.addProject")}</Button>
            }
          />
        )}
        <ul aria-label={t("projectsUi.list")} className="flex flex-col gap-2">
          {(list?.projects ?? []).map((project) => (
            <li
              key={project.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm"
            >
              <Button variant="ghost" size="sm" onClick={() => props.onOpenBoard(project.id)}>
                {t("projectsUi.openBoard", { name: project.name })}
              </Button>
              <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">{`${project.path} · ${project.baseBranch}`}</span>
              <TerminalButton
                store={store}
                hostId={hostId}
                target={{ cwd: project.path, claudeSessionId: null }}
                name={project.name}
              />
              <Button variant="ghost" size="sm" onClick={() => props.onOpenWorkflows(project)}>
                {t("projectsUi.workflows", { name: project.name })}
              </Button>
              {props.agent && (
                <Button variant="ghost" size="sm" onClick={() => props.onOpenAgent(project)}>
                  {t("agent.open", { name: project.name })}
                </Button>
              )}
              {props.actions && (
                <Button variant="ghost" size="sm" onClick={() => props.onOpenActions(project)}>
                  {t("projectsUi.actions", { name: project.name })}
                </Button>
              )}
              {props.automations && (
                <Button variant="ghost" size="sm" onClick={() => props.onOpenAutomations(project)}>
                  {t("projectsUi.automations", { name: project.name })}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(project.id);
                  setDraft(fromProject(project));
                }}
              >
                {t("projectsUi.edit", { name: project.name })}
              </Button>
            </li>
          ))}
        </ul>
        <Panel title={editing ? t("projectsUi.editTitle") : t("projectsUi.newTitle")}>
          <Input
            ref={pathField}
            aria-label={t("projectsUi.path")}
            placeholder={t("projects.pathPlaceholder")}
            disabled={editing !== null}
            {...field("path")}
          />
          {editing === null && host && hasFeature(host.hostInfo?.features, "fs.dirs", false) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setBrowsing(true)}
            >
              {t("folderPicker.browse")}
            </Button>
          )}
          {browsing && host && (
            <FolderPicker
              store={store}
              host={host}
              onPick={(path) => {
                setBrowsing(false);
                setDraft({ ...draft, path });
              }}
              onClose={() => setBrowsing(false)}
            />
          )}
          <Input
            aria-label={t("projectsUi.name")}
            placeholder={t("projectsUi.name")}
            {...field("name")}
          />
          <Input
            aria-label={t("projectsUi.baseBranch")}
            placeholder={t("projectsUi.baseBranch")}
            {...field("baseBranch")}
          />
          <NativeSelect aria-label={t("projectsUi.prProvider")} {...field("prProvider")}>
            <option value="none">{t("projectsUi.noPr")}</option>
            <option value="github">GitHub (gh)</option>
            <option value="azure-devops">Azure DevOps (az)</option>
          </NativeSelect>
          <Input
            aria-label={t("projectsUi.setup")}
            placeholder={t("projectsUi.setupPlaceholder")}
            {...field("setupScript")}
          />
          <Textarea
            aria-label={t("projectsUi.template")}
            placeholder={t("projectsUi.templatePlaceholder")}
            {...field("promptTemplate")}
          />
          {editing &&
            props.personas &&
            COLUMNS.map((column) => (
              <PersonaPicker
                key={column}
                store={store}
                hostId={hostId}
                label={t("projectsUi.columnPersona", {
                  column: t(`kanban.columns.${column}`),
                })}
                value={draft.personaByColumn[column] ?? ""}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    personaByColumn: { ...draft.personaByColumn, [column]: value },
                  })
                }
                idsOnly
              />
            ))}
          {editing && list?.projects.find((p) => p.id === editing)?.worktreeInclude === false && (
            <div className="flex flex-col gap-2">
              <InlineNotice tone="info">{t("projectsUi.worktreeIncludeMissing")}</InlineNotice>
              <figure aria-label={t("projectsUi.worktreeIncludeExample")}>
                <pre className="rounded-md border bg-muted p-3 font-mono text-xs">
                  {WORKTREE_INCLUDE_EXAMPLE}
                </pre>
              </figure>
            </div>
          )}
          <Button className="self-start" onClick={() => void submit()}>
            {editing ? t("projectsUi.save") : t("projectsUi.register")}
          </Button>
        </Panel>
        {editing && props.rules && (
          <RulesSection key={editing} store={store} hostId={hostId} projectId={editing} />
        )}
        <Panel title={t("projectsUi.hostLimit")}>
          <div className="flex items-center gap-2">
            <Input
              aria-label={t("projectsUi.parallel")}
              type="number"
              min={1}
              className="w-28"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
            <Button
              variant="outline"
              onClick={() =>
                void store.hostCommand(hostId, "board.settings", {
                  maxParallelRuns: Number(limit),
                })
              }
            >
              {t("projectsUi.saveLimit")}
            </Button>
          </div>
        </Panel>
      </div>
    </Page>
  );
}
