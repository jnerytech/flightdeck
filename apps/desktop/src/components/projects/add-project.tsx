import type { Project } from "@flightdeck/protocol";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { shortPath } from "@/lib/approval";
import { suggestFolders } from "@/lib/project-suggestions";
import { hasFeature } from "@/lib/version";
import { FolderPicker } from "@/ui/FolderPicker";

/** How many characters of a suggested folder fit a row of the dialog at 390 px. */
const SUGGESTED_MAX = 40;

/**
 * The one flow that registers a folder of a host as a project (Board, Workflows, Teams and the
 * Projects screen): the button, then a dialog with the folders of the host's recent sessions, a
 * typed or browsed folder, and Add.
 */
export function AddProject(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    onAdded(project: Project): void;
    variant?: "default" | "outline";
    /** The button's text; "Add project" when left out. */
    label?: string;
    /** No button: the caller opens the form (the dialog starts open) and hears when it is closed. */
    bare?: boolean;
    onClosed?(): void;
  }>,
) {
  const { store, hostId } = props;
  const t = useT();
  const [openState, setOpenState] = useState(props.bare === true);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    if (!next) props.onClosed?.();
  };
  const [path, setPath] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const host = store.getState().hosts.find((h) => h.id === hostId);
  const suggestions = suggestFolders(
    host?.sessions ?? [],
    host?.info?.allowedRoots ?? [],
    store.getState().projects[hostId] ?? [],
  );
  const add = async (folder: string) => {
    const project = await store.hostCommand(hostId, "project.add", { path: folder });
    if (!project) return;
    const known = store.getState().projects[hostId] ?? [];
    store.rememberProjects(hostId, [...known.filter((p) => p.id !== project.id), project]);
    setOpen(false);
    setPath("");
    props.onAdded(project);
  };
  return (
    <>
      {!props.bare && (
        <Button variant={props.variant ?? "default"} onClick={() => setOpen(true)}>
          <Plus aria-hidden="true" />
          {props.label ?? t("states.addProject")}
        </Button>
      )}
      {openState && (
        <Dialog open onOpenChange={(next) => !next && setOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("addProject.title")}</DialogTitle>
              <DialogDescription>{t("addProject.description")}</DialogDescription>
            </DialogHeader>
            {suggestions.length > 0 && (
              <section
                aria-label={t("addProject.suggested")}
                className="flex min-w-0 flex-col gap-1"
              >
                <p className="text-muted-foreground text-xs">{t("addProject.suggested")}</p>
                {suggestions.map((folder) => (
                  // #1049: a worktree's folder is wider than the dialog. Whole, it pushed Cancel and
                  // Add out of the dialog; cut at its end, the rows read the same. Cut in the middle,
                  // the end that tells them apart shows, and the whole path is the tooltip.
                  <Button
                    key={folder}
                    variant="outline"
                    size="sm"
                    title={folder}
                    className="min-w-0 justify-start font-mono text-xs"
                    onClick={() => void add(folder)}
                  >
                    <span className="truncate">{shortPath(folder, SUGGESTED_MAX)}</span>
                  </Button>
                ))}
              </section>
            )}
            <Input
              aria-label={t("addProject.folder")}
              placeholder={t("projects.pathPlaceholder")}
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
            {host && hasFeature(host.hostInfo?.features, "fs.dirs", false) && (
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
                onPick={(picked) => {
                  setBrowsing(false);
                  setPath(picked);
                }}
                onClose={() => setBrowsing(false)}
              />
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <ActionButton
                disabled={!path.trim()}
                disabledReason={t("addProject.folderNeeded")}
                onClick={() => add(path.trim())}
              >
                {t("addProject.add")}
              </ActionButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
