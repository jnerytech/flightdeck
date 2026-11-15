import type { BoardColumn, Project, PrProviderKind } from "@flightdeck/protocol";
import { type RefObject, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PersonaPicker } from "@/features/personas/ui.ts";
import { InlineNotice } from "@/shared/feedback/index.ts";
import { NativeSelect, Panel } from "@/shared/layout/index.ts";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import { hasFeature } from "../../lib/version.ts";
import { FolderPicker } from "../hosts/ui.ts";

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

/**
 * Register a project or edit one. It starts from the project being edited, or empty; the page
 * gives it a new `key` to start over from another project, and it empties itself after a save.
 */
export function ProjectForm(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    host: HostView | undefined;
    /** The project being edited, or null to register a new one. */
    editing: string | null;
    /** The listed project being edited: it fills the form at first and says whether it has a `.worktreeinclude`. */
    project: Project | undefined;
    /** The host announces `personas` (phase 20): a default persona per board column. */
    personas?: boolean;
    /** The path field, so the page's empty state can send the focus to it. */
    pathField: RefObject<HTMLInputElement | null>;
    /** The project was saved. */
    onSaved(): void;
  }>,
) {
  const { store, hostId, host, editing } = props;
  const { t } = store.i18n;
  const [draft, setDraft] = useState<Draft>(() =>
    props.project ? fromProject(props.project) : EMPTY,
  );
  const [browsing, setBrowsing] = useState(false);

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
      // The same form stays mounted (the focus stays on its button) and starts over.
      setDraft(EMPTY);
      props.onSaved();
    }
  };

  const field = (key: Exclude<keyof Draft, "personaByColumn">) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value }),
  });

  return (
    <Panel title={editing ? t("projectsUi.editTitle") : t("projectsUi.newTitle")}>
      <Input
        ref={props.pathField}
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
      {editing && props.project?.worktreeInclude === false && (
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
  );
}
