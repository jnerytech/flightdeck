import type { ProjectsScanResult } from "@flightdeck/protocol";
import { Search } from "lucide-react";
import { useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { NativeSelect } from "@/components/layout/form";
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

/** "Find my projects": scan the allowed folders for git repositories, or clone one from a URL. */
export function FindProjects(
  props: Readonly<{ store: AppStore; hostId: string; onAdded(): void }>,
) {
  const { store, hostId } = props;
  const t = useT();
  const [open, setOpen] = useState(false);
  const [scan, setScan] = useState<{
    repos: ProjectsScanResult["repos"];
    truncated: boolean;
  } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const roots = store.getState().hosts.find((h) => h.id === hostId)?.info?.allowedRoots ?? [];
  const [root, setRoot] = useState(roots[0] ?? "");

  /** Registers a folder as a project; false when the host refused (it already said why). */
  const register = async (path: string) => {
    const project = await store.hostCommand(hostId, "project.add", { path });
    if (!project) return false;
    const known = store.getState().projects[hostId] ?? [];
    store.rememberProjects(hostId, [...known.filter((p) => p.id !== project.id), project]);
    return true;
  };
  const find = async () => {
    const [found, projects] = await Promise.all([
      store.hostCommand(hostId, "projects.scan", {}),
      store.hostCommand(hostId, "project.list", {}),
    ]);
    if (!found) return;
    const have = new Set((projects?.projects ?? []).map((p) => p.path));
    setScan({ repos: found.repos.filter((r) => !have.has(r.path)), truncated: found.truncated });
    setPicked([]);
  };
  const addPicked = async () => {
    const added: string[] = [];
    for (const path of picked) if (await register(path)) added.push(path);
    if (added.length > 0) props.onAdded();
    setScan((now) => now && { ...now, repos: now.repos.filter((r) => !added.includes(r.path)) });
    setPicked((now) => now.filter((path) => !added.includes(path)));
  };
  const clone = async () => {
    const cloned = await store.hostCommand(hostId, "projects.clone", {
      url: url.trim(),
      root,
      ...(name.trim() ? { name: name.trim() } : {}),
    });
    if (!cloned) return;
    setUrl("");
    setName("");
    if (await register(cloned.path)) props.onAdded();
  };
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Search aria-hidden="true" />
        {t("findProjects.open")}
      </Button>
      {open && (
        <Dialog open onOpenChange={(next) => !next && setOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("findProjects.title")}</DialogTitle>
              <DialogDescription>{t("findProjects.description")}</DialogDescription>
            </DialogHeader>
            <section className="find-block">
              <ActionButton variant="outline" size="sm" onClick={find}>
                {t("findProjects.scan")}
              </ActionButton>
              {scan?.truncated && <InlineNotice>{t("findProjects.truncated")}</InlineNotice>}
              {scan && scan.repos.length === 0 && (
                <p className="text-muted-foreground text-sm">{t("findProjects.none")}</p>
              )}
              {scan && scan.repos.length > 0 && (
                <>
                  <ul aria-label={t("findProjects.found")} className="check-list">
                    {scan.repos.map((repo) => (
                      <li key={repo.path}>
                        <label className="check-line">
                          <input
                            type="checkbox"
                            className="hit-control"
                            checked={picked.includes(repo.path)}
                            onChange={(e) =>
                              setPicked((now) =>
                                e.target.checked
                                  ? [...now, repo.path]
                                  : now.filter((path) => path !== repo.path),
                              )
                            }
                          />
                          <span className="font-mono text-xs">{repo.path}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <ActionButton
                    size="sm"
                    disabled={picked.length === 0}
                    disabledReason={t("findProjects.pickOne")}
                    onClick={addPicked}
                  >
                    {t("findProjects.addSelected", { n: picked.length })}
                  </ActionButton>
                </>
              )}
            </section>
            <section aria-label={t("findProjects.cloneTitle")} className="find-block">
              <p className="font-medium text-sm">{t("findProjects.cloneTitle")}</p>
              <Input
                aria-label={t("findProjects.url")}
                placeholder="https://github.com/owner/repo.git"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <NativeSelect
                aria-label={t("findProjects.root")}
                value={root}
                onChange={(e) => setRoot(e.target.value)}
              >
                {roots.map((folder) => (
                  <option key={folder} value={folder}>
                    {folder}
                  </option>
                ))}
              </NativeSelect>
              <Input
                aria-label={t("findProjects.name")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <ActionButton
                size="sm"
                disabled={!url.trim() || !root}
                disabledReason={t("findProjects.urlHint")}
                onClick={clone}
              >
                {t("findProjects.clone")}
              </ActionButton>
            </section>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
