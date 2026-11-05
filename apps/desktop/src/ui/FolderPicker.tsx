import type { FsDirsResult, FsFilesResult } from "@flightdeck/protocol";
import { ArrowUp, ChevronRight, File, Folder } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { AllowedFolders } from "@/components/hosts/allowed-folders";
import { FieldRow } from "@/components/layout/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n/context";
import type { AppStore, HostView } from "../lib/app-store.ts";
import { breadcrumbSteps, isInside } from "../lib/paths.ts";
import { isLocalUrl } from "../lib/terminal.ts";

/** Arrow keys move through the folder buttons, Enter opens the focused one; false for any other key. */
function moveByKey(event: React.KeyboardEvent<HTMLUListElement>): boolean {
  const entries = [...event.currentTarget.querySelectorAll<HTMLElement>("button")];
  const at = entries.indexOf(document.activeElement as HTMLElement);
  if (event.key === "ArrowDown") entries[Math.min(at + 1, entries.length - 1)]?.focus();
  else if (event.key === "ArrowUp") entries[Math.max(at - 1, 0)]?.focus();
  else if (event.key === "Enter") entries[at]?.click();
  else return false;
  return true;
}

/**
 * A folder of a host, chosen by browsing the folders it allows (`fs.dirs`): the roots, then
 * subfolders, a breadcrumb, the arrow keys. On this machine the system dialog is offered too; what
 * it gives is checked by the host like everything else.
 */
export function FolderPicker(
  props: Readonly<{
    store: AppStore;
    host: HostView;
    /** Also list the files of the open folder, and let one be picked. */
    files?: boolean;
    onPick(path: string): void;
    onClose(): void;
  }>,
) {
  const { store, host } = props;
  const t = useT();
  const [listing, setListing] = useState<FsDirsResult | null>(null);
  /** The allowed roots, as the host resolves them: where the breadcrumb starts. */
  const [roots, setRoots] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** The folder just clicked, current from the click until its listing arrives (`undefined` is the roots). */
  const [target, setTarget] = useState<{ path?: string } | null>(null);
  const [hidden, setHidden] = useState(false);
  /** The files of the folder shown, when the picker takes files too. */
  const [files, setFiles] = useState<FsFilesResult["files"]>([]);
  const allowed = host.info?.allowedRoots ?? [];

  /** The folder being shown, kept apart from `listing` so a reload does not restart the effect. */
  const shown = useRef<string | undefined>(undefined);
  const hiddenNow = useRef(hidden);
  hiddenNow.current = hidden;

  const describe = (code: string, message: string) =>
    code === "forbidden_cwd" ? t("folderPicker.outside", { roots: allowed.join(", ") }) : message;

  /** The files of a folder, or none when the host cannot list them. */
  const filesOf = async (path: string) => {
    const found = await store.hostRequest(host.id, "fs.files", {
      path,
      ...(hiddenNow.current ? { hidden: true } : {}),
    });
    return found.ok && found.data ? (found.data as FsFilesResult).files : [];
  };

  const opening = useRef(0);
  const rootCount = allowed.length;

  const open = async (path?: string) => {
    const ticket = ++opening.current;
    setTarget({ path });
    const result = await store.hostRequest(host.id, "fs.dirs", {
      ...(path === undefined ? {} : { path }),
      ...(hiddenNow.current ? { hidden: true } : {}),
    });
    if (ticket !== opening.current) return;
    setTarget(null);
    if (!result.ok) return setError(describe(result.code, result.message));
    setError(null);
    shown.current = result.data.path ?? undefined;
    setListing(result.data);
    if (props.files && result.data.path) {
      const list = await filesOf(result.data.path);
      if (ticket === opening.current) setFiles(list);
    } else setFiles([]);
    if (path === undefined) setRoots(result.data.dirs.map((dir) => dir.path));
  };
  const openRef = useRef(open);
  openRef.current = open;

  // Opens the roots at first, and the same folder again when the hidden toggle changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `hidden` is the trigger; the rest is read from refs
  useEffect(() => {
    void openRef.current(shown.current);
  }, [hidden, rootCount]);

  // A folder is the current one as soon as it is clicked; its listing follows.
  const loading = target !== null;
  const current = (loading ? target.path : listing?.path) ?? undefined;
  const root = current ? roots.find((r) => isInside(current, r)) : undefined;
  const crumbs = current && root ? breadcrumbSteps(current, root) : [];
  const nativeDialog = store.canPickFolder() && isLocalUrl(host.url);

  const chooseWithSystem = async () => {
    const picked = await store.pickFolder();
    if (!picked) return;
    const result = await store.hostRequest(host.id, "fs.dirs", { path: picked });
    if (result.ok && result.data.path) props.onPick(result.data.path);
    else if (!result.ok) setError(describe(result.code, result.message));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const moved = moveByKey(event);
    if (!moved && event.key !== "Backspace") return;
    if (!moved) void open(listing?.parent ?? undefined);
    event.preventDefault();
  };

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("folderPicker.title")}</DialogTitle>
          <DialogDescription>{t("folderPicker.description")}</DialogDescription>
        </DialogHeader>
        <nav
          aria-label={t("folderPicker.path")}
          className="flex flex-wrap items-center gap-1 text-sm"
        >
          <Button type="button" variant="ghost" size="xs" onClick={() => void open()}>
            {t("folderPicker.roots")}
          </Button>
          {crumbs.map((step, index) => (
            <span key={step.path} className="flex items-center gap-1">
              <ChevronRight className="size-3" aria-hidden />
              {index === crumbs.length - 1 ? (
                <span aria-current="location" title={step.name} className="crumb-name font-medium">
                  {step.name}
                </span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="crumb-name"
                  title={step.name}
                  onClick={() => void open(step.path)}
                >
                  {step.name}
                </Button>
              )}
            </span>
          ))}
        </nav>
        {error && (
          <p role="alert" className="text-sm text-status-error">
            {error}
          </p>
        )}
        {listing === null ? (
          !error && <p className="text-muted-foreground text-sm">{t("folderPicker.loading")}</p>
        ) : (
          <>
            {listing.dirs.length === 0 && allowed.length > 0 && (
              <p className="text-muted-foreground text-sm">{t("folderPicker.empty")}</p>
            )}
            {listing.dirs.length === 0 && allowed.length === 0 && (
              <>
                <p role="status" className="font-medium text-sm">
                  {t("folderPicker.noRoots")}
                </p>
                <AllowedFolders store={store} host={host} />
              </>
            )}
            {loading && (
              <p role="status" className="text-muted-foreground text-sm">
                {t("folderPicker.loading")}
              </p>
            )}
            <ul
              aria-label={t("folderPicker.list")}
              aria-busy={loading}
              className="flex max-h-72 min-w-0 flex-col overflow-y-auto aria-busy:opacity-60"
              onKeyDown={onKeyDown}
            >
              {listing.dirs.map((dir) => (
                <li key={dir.path}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    title={dir.name}
                    onClick={() => void open(dir.path)}
                  >
                    <Folder aria-hidden />
                    <span className="min-w-0 truncate">{dir.name}</span>
                  </Button>
                </li>
              ))}
              {files.map((file) => (
                <li key={file.path}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    title={file.name}
                    onClick={() => props.onPick(file.path)}
                  >
                    <File aria-hidden />
                    <span className="min-w-0 truncate">{file.name}</span>
                  </Button>
                </li>
              ))}
            </ul>
            {listing.truncated && (
              <p className="text-muted-foreground text-xs">
                {t("folderPicker.truncated", { n: String(listing.dirs.length) })}
              </p>
            )}
          </>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          {t("folderPicker.hidden")}
        </label>
        <DialogFooter>
          {/* The buttons wrap onto a second line in a narrow window; the reason a button is
              disabled is the row's help line (issue #99). */}
          <FieldRow className="w-full justify-end">
            {!loading && listing?.parent !== undefined && listing?.path && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto"
                aria-label={t("folderPicker.up")}
                onClick={() => void open(listing.parent ?? undefined)}
              >
                <ArrowUp aria-hidden />
              </Button>
            )}
            {nativeDialog && (
              <Button type="button" variant="outline" onClick={() => void chooseWithSystem()}>
                {t("folderPicker.system")}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={props.onClose}>
              {t("common.cancel")}
            </Button>
            <ActionButton
              type="button"
              disabled={!current}
              disabledReason={t("folderPicker.openFirst")}
              onClick={() => current && props.onPick(current)}
            >
              {t("folderPicker.choose")}
            </ActionButton>
          </FieldRow>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
