import { FolderOpen, ListTodo, Lock, Plus, X } from "lucide-react";
import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AddProject } from "@/features/projects/ui.ts";
import { Inline, Toolbar } from "@/shared/layout/index.ts";
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
    /** The text field, so a clear gives the focus back to it. */
    filterRef: RefObject<HTMLInputElement | null>;
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
        ref={props.filterRef}
        aria-label={t("kanban.filter")}
        placeholder={t("hub.filterPlaceholder")}
        className="h-8 w-40 text-xs"
        value={props.filter}
        onChange={(e) => props.onFilter(e.target.value)}
      />
      {props.filter !== "" && (
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          aria-label={t("board.clearFilterText")}
          onClick={() => {
            props.onFilter("");
            props.filterRef.current?.focus();
          }}
        >
          <X aria-hidden="true" />
        </Button>
      )}
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

/** Above the columns when the filter hides every card: one line, and the way back. */
export function NoCardsMatch(props: Readonly<{ t: T; onClear(): void }>) {
  return (
    <Inline gap={2} className="text-sm text-muted-foreground">
      <p>{props.t("board.noCardsMatch")}</p>
      <Button size="sm" variant="outline" onClick={props.onClear}>
        {props.t("board.clearFilters")}
      </Button>
    </Inline>
  );
}
