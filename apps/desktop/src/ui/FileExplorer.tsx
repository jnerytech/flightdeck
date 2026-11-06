import type { DiffFile, FileEntry, FileListing } from "@flightdeck/protocol";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Inline, Stack } from "@/components/layout/stack";
import { TreeBranch, TreeItem } from "@/components/layout/tree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import { refusalText } from "@/i18n/errors";
import type { AppStore } from "../lib/app-store.ts";

// CodeMirror stays out of the entry chunk (bundle-lazy): the viewer loads on the first open.
const FileViewer = lazy(() => import("./FileViewer.tsx").then((m) => ({ default: m.FileViewer })));

/** A folder as the explorer has it: on its way, listed, or refused with the text to show. */
type Folder = "loading" | FileListing | { refused: string };

const pathOf = (dir: string, name: string) => (dir === "" ? name : `${dir}/${name}`);

/**
 * The files of a session's repository as a tree (issue #506): folders open on click and are asked
 * for once, a changed file carries its status from the Changes tab's diff, a credential shows as
 * hidden, and a filter keeps the names that match among the folders already open.
 */
export function FileExplorer(props: Readonly<{ store: AppStore; hostId: string; target: string }>) {
  const t = useT();
  const { store, hostId, target } = props;
  const [folders, setFolders] = useState<Record<string, Folder>>({});
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [changes, setChanges] = useState<DiffFile[]>([]);
  /** The repository's folder on the host, from the diff: what makes a path whole. */
  const [root, setRoot] = useState<string | null>(null);
  /** The file open in the viewer. */
  const [viewing, setViewing] = useState<string | null>(null);

  const load = useCallback(
    async (dir: string) => {
      setFolders((known) => ({ ...known, [dir]: "loading" }));
      const result = await store.hostRequest(hostId, "file.list", { target, dir });
      const folder = result.ok
        ? result.data
        : { refused: refusalText(result.code, result.message, t, result) };
      setFolders((known) => ({ ...known, [dir]: folder }));
    },
    [store, hostId, target, t],
  );

  useEffect(() => {
    void load("");
  }, [load]);

  // The marks follow the same diff as the Changes tab: read once, then live.
  useEffect(() => {
    void store.hostRequest(hostId, "changes.get", { target }).then((result) => {
      if (!result.ok) return;
      setChanges(result.data.files);
      setRoot(result.data.root);
    });
    return store.watchChanges(hostId, target, (update) => {
      setChanges(update.files);
      setRoot(update.root);
    });
  }, [store, hostId, target]);

  const toggle = (path: string) => {
    const next = new Set(open);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setOpen(next);
    if (!folders[path]) void load(path);
  };

  const status = new Map(changes.map((file) => [file.path, file.status]));
  const changedInside = (dir: string) => changes.some((file) => file.path.startsWith(`${dir}/`));
  const needle = query.trim().toLowerCase();

  /** Whether an entry stays under the filter: its name matches, or something open below it does. */
  const kept = (dir: string, entry: FileEntry): boolean => {
    if (needle === "" || entry.name.toLowerCase().includes(needle)) return true;
    const path = pathOf(dir, entry.name);
    const below = folders[path];
    const children = typeof below === "object" && "entries" in below ? below.entries : [];
    return entry.kind === "dir" && open.has(path) && children.some((child) => kept(path, child));
  };

  const row = (dir: string, entry: FileEntry) => {
    const path = pathOf(dir, entry.name);
    const mark = status.get(path);
    return (
      <TreeItem key={path} id={path}>
        <Stack gap={1}>
          <Inline gap={2} className="text-sm">
            {entry.kind === "dir" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={open.has(path)}
                onClick={() => toggle(path)}
              >
                <span data-name="">{entry.name}</span>
              </Button>
            ) : (
              <FileName entry={entry} onOpen={() => setViewing(path)} />
            )}
            {entry.secret && <Badge variant="outline">{t("files.hidden")}</Badge>}
            {mark && <Badge variant="outline">{t(`changes.status.${mark}`)}</Badge>}
            {entry.kind === "dir" && changedInside(path) && (
              <span className="text-muted-foreground text-xs">{t("files.changedInside")}</span>
            )}
          </Inline>
          {entry.kind === "dir" && open.has(path) && <TreeBranch>{folder(path)}</TreeBranch>}
        </Stack>
      </TreeItem>
    );
  };

  /** A folder's entries under the filter, or why they are not there. */
  function folder(dir: string) {
    const known = folders[dir];
    if (known === undefined || known === "loading") {
      return <li className="text-muted-foreground text-xs">{t("files.loading")}</li>;
    }
    if ("refused" in known) {
      return (
        <li role="alert" className="text-destructive text-xs">
          {known.refused}
        </li>
      );
    }
    const entries = known.entries.filter((entry) => kept(dir, entry));
    return (
      <>
        {entries.map((entry) => row(dir, entry))}
        {dir === "" && needle !== "" && entries.length === 0 && (
          <li className="text-muted-foreground text-sm">{t("files.noMatch")}</li>
        )}
        {known.truncated && (
          <li className="text-muted-foreground text-xs">{t("files.truncated")}</li>
        )}
      </>
    );
  }

  return (
    <section aria-label={t("files.region")}>
      <Stack gap={2}>
        <Input
          type="search"
          aria-label={t("files.filter")}
          placeholder={t("files.filter")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Stack as="ul" gap={1}>
          {folder("")}
        </Stack>
        {viewing && (
          <Suspense fallback={null}>
            <FileViewer
              key={viewing}
              store={store}
              hostId={hostId}
              target={target}
              path={viewing}
              diff={changes.find((file) => file.path === viewing)}
              full={root === null ? null : `${root}/${viewing}`}
              onClose={() => setViewing(null)}
            />
          </Suspense>
        )}
      </Stack>
    </section>
  );
}

/** A file's name: a button that opens it, or plain text for a credential, which never opens. */
function FileName(props: Readonly<{ entry: FileEntry; onOpen(): void }>) {
  const name = (
    <span data-name="" className="font-mono text-xs">
      {props.entry.name}
    </span>
  );
  if (props.entry.secret) return name;
  return (
    <Button type="button" variant="ghost" size="sm" onClick={props.onOpen}>
      {name}
    </Button>
  );
}
