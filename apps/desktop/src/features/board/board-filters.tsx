import { FolderOpen, ListTodo, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AddProject } from "@/features/projects/ui.ts";
import { Toolbar } from "@/shared/layout/index.ts";
import type { T } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { BoardSyncControl } from "./board-sync.tsx";

/** The board's toolbar: the text filter, the blocked filter, sync, files, issues, Add project and New card. */
export function BoardFilters(
  props: Readonly<{
    t: T;
    store: AppStore;
    hostId: string;
    projectId: string;
    filter: string;
    onFilter(value: string): void;
    /** The host announces dependencies: the blocked-only filter shows. */
    withDeps: boolean;
    onlyBlocked: boolean;
    onToggleBlocked(): void;
    withSync: boolean;
    /** The picked worktree has files to show: the Files button shows. */
    withFiles: boolean;
    filesShown: boolean;
    onToggleFiles(): void;
    withIssues: boolean;
    onOpenIssues(): void;
    onOpenProject?(projectId: string): void;
    onNewCard(): void;
  }>,
) {
  const { t, store, hostId, projectId } = props;
  return (
    <Toolbar label={t("hub.filters")}>
      <Input
        aria-label={t("kanban.filter")}
        placeholder={t("hub.filterPlaceholder")}
        className="h-8 w-40 text-xs"
        value={props.filter}
        onChange={(e) => props.onFilter(e.target.value)}
      />
      {props.withDeps && (
        <Button
          size="sm"
          variant="outline"
          aria-pressed={props.onlyBlocked}
          onClick={props.onToggleBlocked}
        >
          <Lock aria-hidden="true" />
          {t("deps.filter")}
        </Button>
      )}
      {props.withSync && <BoardSyncControl store={store} hostId={hostId} projectId={projectId} />}
      {props.withFiles && (
        <Button
          size="sm"
          variant="outline"
          aria-pressed={props.filesShown}
          onClick={props.onToggleFiles}
        >
          <FolderOpen aria-hidden="true" />
          {t("board.files")}
        </Button>
      )}
      {props.withIssues && (
        <Button size="sm" variant="outline" onClick={props.onOpenIssues}>
          <ListTodo aria-hidden="true" />
          {t("issuesUi.button")}
        </Button>
      )}
      <AddProject
        store={store}
        hostId={hostId}
        variant="outline"
        onAdded={(added) => props.onOpenProject?.(added.id)}
      />
      <Button size="sm" onClick={props.onNewCard}>
        <Plus aria-hidden="true" />
        {t("kanban.newCard")}
      </Button>
    </Toolbar>
  );
}
