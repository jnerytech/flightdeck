import type { FsDirsResult } from "@flightdeck/protocol";
import { ArrowUp, ChevronRight, Folder } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { useT } from "@/i18n/context";
import type { AppStore, HostView } from "../lib/app-store.ts";
import { isLocalUrl } from "../lib/terminal.ts";

/** The steps from a root down to `path`: each with the path it opens. */
function steps(path: string, root: string): Array<{ name: string; path: string }> {
  const sep = root.includes("\\") ? "\\" : "/";
  const rest = path.slice(root.length).split(/[\\/]/).filter(Boolean);
  const out = [{ name: root.split(/[\\/]/).filter(Boolean).at(-1) ?? root, path: root }];
  for (const part of rest) {
    const last = out.at(-1)?.path ?? root;
    out.push({ name: part, path: `${last.replace(/[\\/]+$/, "")}${sep}${part}` });
  }
  return out;
}

/**
 * A folder of a host, chosen by browsing the folders it allows (`fs.dirs`): the roots, then
 * subfolders, a breadcrumb, the arrow keys. On this machine the system dialog is offered too; what
 * it gives is checked by the host like everything else.
 */
export function FolderPicker(props: {
  store: AppStore;
  host: HostView;
  onPick(path: string): void;
  onClose(): void;
}) {
  const { store, host } = props;
  const t = useT();
  const [listing, setListing] = useState<FsDirsResult | null>(null);
  /** The allowed roots, as the host resolves them: where the breadcrumb starts. */
  const [roots, setRoots] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const allowed = host.info?.allowedRoots ?? [];

  /** The folder being shown, kept apart from `listing` so a reload does not restart the effect. */
  const shown = useRef<string | undefined>(undefined);
  const hiddenNow = useRef(hidden);
  hiddenNow.current = hidden;

  const describe = (code: string, message: string) =>
    code === "forbidden_cwd" ? t("folderPicker.outside", { roots: allowed.join(", ") }) : message;

  const open = async (path?: string) => {
    const result = await store.hostRequest(host.id, "fs.dirs", {
      ...(path === undefined ? {} : { path }),
      ...(hiddenNow.current ? { hidden: true } : {}),
    });
    if (!result.ok) return setError(describe(result.code, result.message));
    setError(null);
    shown.current = result.data.path ?? undefined;
    setListing(result.data);
    if (path === undefined) setRoots(result.data.dirs.map((dir) => dir.path));
  };
  const openRef = useRef(open);
  openRef.current = open;

  // Opens the roots at first, and the same folder again when the hidden toggle changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `hidden` is the trigger; the rest is read from refs
  useEffect(() => {
    void openRef.current(shown.current);
  }, [hidden]);

  const root = listing?.path ? roots.find((r) => listing.path?.startsWith(r)) : undefined;
  const crumbs = listing?.path && root ? steps(listing.path, root) : [];
  const nativeDialog = store.canPickFolder() && isLocalUrl(host.url);

  const chooseWithSystem = async () => {
    const picked = await store.pickFolder();
    if (!picked) return;
    const result = await store.hostRequest(host.id, "fs.dirs", { path: picked });
    if (result.ok && result.data.path) props.onPick(result.data.path);
    else if (!result.ok) setError(describe(result.code, result.message));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const entries = [...event.currentTarget.querySelectorAll<HTMLElement>("button")];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") entries[Math.min(at + 1, entries.length - 1)]?.focus();
    else if (event.key === "ArrowUp") entries[Math.max(at - 1, 0)]?.focus();
    else if (event.key === "Enter") entries[at]?.click();
    else if (event.key === "Backspace") void open(listing?.parent ?? undefined);
    else return;
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
          <Button type="button" variant="ghost" size="xs" onClick={() => void open(undefined)}>
            {t("folderPicker.roots")}
          </Button>
          {crumbs.map((step, index) => (
            <span key={step.path} className="flex items-center gap-1">
              <ChevronRight className="size-3" aria-hidden />
              {index === crumbs.length - 1 ? (
                <span aria-current="location" className="font-medium">
                  {step.name}
                </span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
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
            {listing.dirs.length === 0 && (
              <p className="text-muted-foreground text-sm">{t("folderPicker.empty")}</p>
            )}
            <ul
              aria-label={t("folderPicker.list")}
              className="flex max-h-72 flex-col overflow-y-auto"
              onKeyDown={onKeyDown}
            >
              {listing.dirs.map((dir) => (
                <li key={dir.path}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => void open(dir.path)}
                  >
                    <Folder aria-hidden />
                    {dir.name}
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
          {listing?.parent !== undefined && listing?.path && (
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
            disabled={!listing?.path}
            disabledReason={t("folderPicker.openFirst")}
            onClick={() => listing?.path && props.onPick(listing.path)}
          >
            {t("folderPicker.choose")}
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
