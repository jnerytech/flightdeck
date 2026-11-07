import type { AppStore } from "../lib/app-store.ts";
import type { BoardFiles } from "../lib/board-files.ts";
import { FileExplorer } from "./FileExplorer.tsx";

/**
 * The files of the worktree the sidebar picked, beside the board (#117). The tree is keyed by its
 * target, so another worktree starts with its own folders and never the ones the last had open.
 */
export function BoardFilesPanel(
  props: Readonly<{ store: AppStore; hostId: string; files: BoardFiles }>,
) {
  const { store, hostId, files } = props;
  const { t } = store.i18n;
  const title = t("board.filesOf", { branch: files.branch });
  return (
    <aside aria-label={title} data-slot="board-files" className="board-files">
      <h3 className="font-semibold text-sm">{title}</h3>
      {files.kind === "worktree" ? (
        <FileExplorer key={files.target} store={store} hostId={hostId} target={files.target} />
      ) : (
        <p className="text-muted-foreground text-sm">{t("board.filesPrimary")}</p>
      )}
    </aside>
  );
}
