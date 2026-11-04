import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { T } from "../../i18n/index.ts";
import type { WorktreeFilter } from "../../lib/project-tree.ts";

/** The branch the sidebar tree narrowed this screen to, with the button that clears it. */
export function WorktreeChip(props: { filter: WorktreeFilter; t: T; onClear(): void }) {
  return (
    <div className="filter-chip self-start rounded-full border bg-muted/40 text-xs">
      <span>{props.t("projectTree.filter", { branch: props.filter.branch })}</span>
      <Button
        variant="ghost"
        size="icon"
        className="size-5"
        aria-label={props.t("projectTree.clear")}
        onClick={props.onClear}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}
