import { useEffect, useState } from "react";
import type { HostView } from "../../lib/app-store.ts";
import { hasFeature } from "../../lib/version.ts";
import { joinPath, startFolder, underRoot } from "./domain/new-session.ts";
import type { RememberedFolder } from "./domain/new-session-choices.ts";

/**
 * The folder a new session starts in: one of the host's allowedRoots plus a subfolder (#1589).
 * `kept` is the folder the last session here started in (issue #1135); `canBrowse` is true when the
 * host answers `fs.dirs` and the form has a store to ask it with; `onFolder` is told the folder as
 * it is chosen, so what depends on it (a client's persona) can follow.
 */
export function useFolderChoice(props: {
  host: HostView;
  kept: RememberedFolder | undefined;
  canAsk: boolean;
  onFolder?(cwd: string): void;
}) {
  const { host, kept, onFolder } = props;
  const roots = host.info?.allowedRoots ?? [];
  // The folder picked, else the host's first: its folders may arrive after the form opened.
  const [picked, setPicked] = useState<string | null>(null);
  // The subfolder typed; before that, the remembered one (only with the remembered folder).
  const [typedSub, setTypedSub] = useState<string | null>(null);
  const { root, sub } = startFolder({ roots, picked, typedSub, kept });
  const [browsing, setBrowsing] = useState(false);
  /** The host answers `fs.dirs`: an older daemon does not, and there the folder is typed. */
  const canBrowse = props.canAsk && hasFeature(host.hostInfo?.features, "fs.dirs", false);
  /** A folder the host resolved to a path none of its configured roots start: kept as a root. */
  const [extra, setExtra] = useState<string | null>(null);
  const folders = extra && !roots.includes(extra) ? [...roots, extra] : roots;
  const pick = (path: string) => {
    setBrowsing(false);
    // The configured root that holds it; its rest is the subfolder.
    const held = underRoot(path, roots);
    if (held) {
      setPicked(held.root);
      setTypedSub(held.sub);
    } else {
      setExtra(path);
      setPicked(path);
      setTypedSub("");
    }
  };
  const cwd = joinPath(root, sub);
  useEffect(() => onFolder?.(cwd), [onFolder, cwd]);
  return {
    root,
    sub,
    cwd,
    folders,
    canBrowse,
    browsing,
    setBrowsing,
    setPicked,
    setTypedSub,
    pick,
  };
}
