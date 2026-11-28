import type { FsDirsResult, FsFilesResult } from "@flightdeck/protocol";
import { ArrowUp, ChevronRight, File, Folder } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { ActionButton, IconTip } from "@/shared/feedback/index.ts";
import { FieldRow } from "@/shared/layout/index.ts";
import { breadcrumbSteps, isInside } from "@/shared/lib/index.ts";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import { isLocalUrl } from "../terminal/index.ts";
import { AllowedFolders } from "./allowed-folders.tsx";

/** The files of the open folder: being read, listed (maybe cut short), or `failed` when the host refused. */
type FileRead = { files: FsFilesResult["files"]; truncated: boolean } | "loading" | "failed";
const NO_FILES: FileRead = { files: [], truncated: false };

/** Arrow keys move through the folder buttons, Enter opens the focused one; false for any other key. */
function moveByKey(event: KeyboardEvent, list: HTMLElement): boolean {
  const entries = [...list.querySelectorAll<HTMLElement>("button")];
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
  /** The files of the folder shown, when the picker takes files too; `failed` when the host refused to list them. */
  const [fileRead, setFileRead] = useState<FileRead>(NO_FILES);
  const files = typeof fileRead === "object" ? fileRead.files : [];
  /** The folder whose files Try again is reading; its button stays so the focus stays. */
  const [retryingAt, setRetryingAt] = useState<string | null>(null);
  /** Set by Try again: once the read settles, the focus goes to the list instead of falling to the page. */
  const refocus = useRef(false);
  const listNode = useRef<HTMLUListElement | null>(null);
  const allowed = host.info?.allowedRoots ?? [];

  /** The folder being shown, kept apart from `listing` so a reload does not restart the effect. */
  const shown = useRef<string | undefined>(undefined);
  const hiddenNow = useRef(hidden);
  hiddenNow.current = hidden;

  const describe = (code: string, message: string) =>
    code === "forbidden_cwd" ? t("folderPicker.outside", { roots: allowed.join(", ") }) : message;

  /** The files of a folder, or `failed` when the host cannot list them (not the same as a folder with none). */
  const filesOf = async (path: string): Promise<FileRead> => {
    const found = await store.hostRequest(host.id, "fs.files", {
      path,
      ...(hiddenNow.current ? { hidden: true } : {}),
    });
    if (!found.ok || !found.data) return "failed";
    const { files: list, truncated } = found.data as FsFilesResult;
    return { files: list, truncated };
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
    if (!result.ok) {
      setTarget(null);
      // A files read of the folder still shown was dropped by this open: let it be read again.
      setFileRead((read) => (read === "loading" ? "failed" : read));
      return setError(describe(result.code, result.message));
    }
    setTarget(null);
    setError(null);
    shown.current = result.data.path ?? undefined;
    setListing(result.data);
    // The folders show at once; the files follow, and "nothing here" waits for them.
    const wanted = props.files ? result.data.path : null;
    setFileRead(wanted ? "loading" : NO_FILES);
    if (path === undefined) setRoots(result.data.dirs.map((dir) => dir.path));
    if (!wanted) return;
    const read = await filesOf(wanted);
    if (ticket === opening.current) setFileRead(read);
  };

  /** Reads the files of the open folder again after a refusal. */
  const retryFiles = async () => {
    const at = shown.current;
    if (!at || retryingAt === at) return;
    const ticket = opening.current;
    refocus.current = true;
    setRetryingAt(at);
    const read = await filesOf(at);
    setRetryingAt((now) => (now === at ? null : now));
    // Only the folder still shown takes the answer: a click on another folder may be on its way.
    if (ticket === opening.current && shown.current === at) setFileRead(read);
    else refocus.current = false;
  };

  // The Try again button leaves with the failure: hand the focus to the list.
  useEffect(() => {
    if (retryingAt !== null || !refocus.current) return;
    refocus.current = false;
    if (typeof fileRead === "object") listNode.current?.querySelector("button")?.focus();
  }, [retryingAt, fileRead]);
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
  const nativeDialog = store.system.canPickFolder() && isLocalUrl(host.url);

  const chooseWithSystem = async () => {
    const picked = await store.system.pickFolder();
    if (!picked) return;
    const result = await store.hostRequest(host.id, "fs.dirs", { path: picked });
    if (result.ok && result.data.path) props.onPick(result.data.path);
    else if (!result.ok) setError(describe(result.code, result.message));
  };

  const parentRef = useRef<string | undefined>(undefined);
  parentRef.current = listing?.parent ?? undefined;

  // The keys of the folder buttons, caught on the list they bubble to. The list is not itself
  // interactive, so the listener goes on the element and not on a React prop of a `<ul>`.
  const listRef = useCallback((list: HTMLUListElement) => {
    listNode.current = list;
    const onKeyDown = (event: KeyboardEvent) => {
      const moved = moveByKey(event, list);
      if (!moved && event.key !== "Backspace") return;
      if (!moved) void openRef.current(parentRef.current);
      event.preventDefault();
    };
    list.addEventListener("keydown", onKeyDown);
    return () => list.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(props.files ? "folderPicker.titleFiles" : "folderPicker.title")}
          </DialogTitle>
          <DialogDescription>
            {t(props.files ? "folderPicker.descriptionFiles" : "folderPicker.description")}
          </DialogDescription>
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
                <IconTip label={step.name}>
                  <span aria-current="location" className="crumb-name font-medium">
                    {step.name}
                  </span>
                </IconTip>
              ) : (
                <IconTip label={step.name}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="crumb-name"
                    onClick={() => void open(step.path)}
                  >
                    {step.name}
                  </Button>
                </IconTip>
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
            {listing.dirs.length === 0 && allowed.length > 0 && !props.files && (
              <p className="text-muted-foreground text-sm">{t("folderPicker.empty")}</p>
            )}
            {props.files && fileRead === "failed" && (
              <FieldRow>
                {retryingAt !== null && retryingAt === listing?.path ? (
                  <output className="text-muted-foreground text-sm">
                    {t("folderPicker.filesLoading")}
                  </output>
                ) : (
                  <p role="alert" className="text-sm text-status-error">
                    {t("folderPicker.filesFailed")}
                  </p>
                )}
                <Button type="button" variant="outline" size="xs" onClick={() => void retryFiles()}>
                  {t("folderPicker.filesRetry")}
                </Button>
              </FieldRow>
            )}
            {props.files && fileRead === "loading" && (
              <output className="text-muted-foreground text-sm">
                {t("folderPicker.filesLoading")}
              </output>
            )}
            {props.files &&
              typeof fileRead === "object" &&
              listing.dirs.length === 0 &&
              files.length === 0 &&
              allowed.length > 0 && (
                <p className="text-muted-foreground text-sm">{t("folderPicker.emptyFiles")}</p>
              )}
            {listing.dirs.length === 0 && allowed.length === 0 && (
              <>
                <output className="font-medium text-sm">{t("folderPicker.noRoots")}</output>
                <AllowedFolders store={store} host={host} />
              </>
            )}
            {loading && (
              <output className="text-muted-foreground text-sm">{t("folderPicker.loading")}</output>
            )}
            <ul
              aria-label={t(props.files ? "folderPicker.listFiles" : "folderPicker.list")}
              aria-busy={loading}
              className="flex max-h-72 min-w-0 flex-col overflow-y-auto aria-busy:opacity-60"
              ref={listRef}
            >
              {listing.dirs.map((dir) => (
                <li key={dir.path}>
                  <IconTip label={dir.name}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => void open(dir.path)}
                    >
                      <Folder aria-hidden />
                      <span className="min-w-0 truncate">{dir.name}</span>
                    </Button>
                  </IconTip>
                </li>
              ))}
              {files.map((file) => (
                <li key={file.path}>
                  <IconTip label={file.name}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => props.onPick(file.path)}
                    >
                      <File aria-hidden />
                      <span className="min-w-0 truncate">{file.name}</span>
                    </Button>
                  </IconTip>
                </li>
              ))}
            </ul>
            {listing.truncated && (
              <p className="text-muted-foreground text-xs">
                {t("folderPicker.truncated", { n: String(listing.dirs.length) })}
              </p>
            )}
            {typeof fileRead === "object" && fileRead.truncated && (
              <p className="text-muted-foreground text-xs">
                {t("folderPicker.truncatedFiles", { n: String(files.length) })}
              </p>
            )}
          </>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          {t(props.files ? "folderPicker.hiddenFiles" : "folderPicker.hidden")}
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
