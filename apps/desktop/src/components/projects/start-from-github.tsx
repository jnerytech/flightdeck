import type { GithubRepoItem, Issue } from "@flightdeck/protocol";
import { GitBranch } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
import { refusalText } from "@/i18n/errors";
import type { AppStore } from "@/lib/app-store";

/**
 * "Start from GitHub" (phase 37): pick a repository, optionally one of its issues, and the host
 * clones it into an allowed folder and opens a card or a session. The host's gh does the talking
 * to GitHub; this dialog never sees a token.
 */
export function StartFromGithub(props: { store: AppStore; hostId: string; onStarted(): void }) {
  const { store, hostId } = props;
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [repos, setRepos] = useState<GithubRepoItem[] | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [issue, setIssue] = useState<string | null>(null);
  const [mode, setMode] = useState<"card" | "session">("card");
  const [error, setError] = useState<string | null>(null);
  const roots = store.getState().hosts.find((h) => h.id === hostId)?.info?.allowedRoots ?? [];
  const [root, setRoot] = useState(roots[0] ?? "");

  /** The answer of a command, or null with the refusal said in the dialog. */
  const ask = useCallback(
    async <T,>(
      run: () => Promise<
        | { ok: true; data: T }
        | {
            ok: false;
            code: string;
            message: string;
            reason?: string;
            params?: Record<string, string | number>;
          }
      >,
    ): Promise<T | null> => {
      const result = await run();
      if (result.ok) {
        setError(null);
        return result.data;
      }
      setError(
        refusalText(result.code, result.message, t, {
          ...(result.reason ? { reason: result.reason } : {}),
          ...(result.params ? { params: result.params } : {}),
        }),
      );
      return null;
    },
    [t],
  );

  const load = useCallback(
    async (text?: string) => {
      const found = await ask(() =>
        store.hostRequest(hostId, "github.repos", text?.trim() ? { query: text.trim() } : {}),
      );
      if (found) {
        setRepos(found.repos);
        setRepo(null);
        setIssues([]);
        setIssue(null);
      }
    },
    [ask, store, hostId],
  );

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const pickRepo = async (name: string) => {
    setRepo(name);
    setIssue(null);
    const found = await ask(() => store.hostRequest(hostId, "github.issues", { repo: name }));
    setIssues(found?.issues ?? []);
  };

  const start = async () => {
    if (!repo) return;
    const started = await ask(() =>
      store.hostRequest(hostId, "github.start", {
        repo,
        root,
        mode,
        ...(issue ? { issue } : {}),
      }),
    );
    if (!started) return;
    props.onStarted();
    setOpen(false);
    if (started.sessionId) {
      store.router.push({ name: "session", host: hostId, id: started.sessionId });
    } else {
      store.router.push({ name: "board", host: hostId, projectId: started.projectId });
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <GitBranch aria-hidden="true" />
        {t("githubStart.open")}
      </Button>
      {open && (
        <Dialog open onOpenChange={(next) => !next && setOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("githubStart.title")}</DialogTitle>
              <DialogDescription>{t("githubStart.description")}</DialogDescription>
            </DialogHeader>
            {error && <InlineNotice tone="error">{error}</InlineNotice>}
            <section className="find-block">
              <div className="flex gap-2">
                <Input
                  aria-label={t("githubStart.search")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <ActionButton variant="outline" size="sm" onClick={() => load(query)}>
                  {t("githubStart.searchButton")}
                </ActionButton>
              </div>
              {repos && repos.length === 0 && (
                <p className="text-muted-foreground text-sm">{t("githubStart.noRepos")}</p>
              )}
              {repos && repos.length > 0 && (
                <ul aria-label={t("githubStart.repos")} className="check-list">
                  {repos.map((item) => (
                    <li key={item.name}>
                      <label className="check-line">
                        <input
                          type="radio"
                          name="github-repo"
                          className="hit-control"
                          checked={repo === item.name}
                          onChange={() => void pickRepo(item.name)}
                        />
                        <span className="font-mono text-xs">
                          {item.name}
                          {item.private ? ` (${t("githubStart.private")})` : ""}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {repo && (
              <section aria-label={t("githubStart.issues", { repo })} className="find-block">
                <p className="font-medium text-sm">{t("githubStart.issues", { repo })}</p>
                <label className="check-line">
                  <input
                    type="radio"
                    name="github-issue"
                    className="hit-control"
                    checked={issue === null}
                    onChange={() => setIssue(null)}
                  />
                  <span className="text-sm">{t("githubStart.wholeRepo")}</span>
                </label>
                {issues.length === 0 && (
                  <p className="text-muted-foreground text-sm">{t("githubStart.noIssues")}</p>
                )}
                {issues.map((item) => (
                  <label key={item.id} className="check-line">
                    <input
                      type="radio"
                      name="github-issue"
                      className="hit-control"
                      checked={issue === item.id}
                      onChange={() => setIssue(item.id)}
                    />
                    <span className="text-sm">
                      #{item.id} {item.title}
                    </span>
                  </label>
                ))}
              </section>
            )}
            <section className="find-block">
              <NativeSelect
                aria-label={t("githubStart.folder")}
                value={root}
                onChange={(e) => setRoot(e.target.value)}
              >
                {roots.map((folder) => (
                  <option key={folder} value={folder}>
                    {folder}
                  </option>
                ))}
              </NativeSelect>
              <fieldset className="flex flex-col gap-1">
                <legend className="text-muted-foreground text-xs">{t("githubStart.mode")}</legend>
                {(["card", "session"] as const).map((kind) => (
                  <label key={kind} className="check-line">
                    <input
                      type="radio"
                      name="github-mode"
                      className="hit-control"
                      checked={mode === kind}
                      onChange={() => setMode(kind)}
                    />
                    <span className="text-sm">
                      {kind === "card" ? t("githubStart.modeCard") : t("githubStart.modeSession")}
                    </span>
                  </label>
                ))}
              </fieldset>
            </section>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <ActionButton
                disabled={!repo || !root}
                disabledReason={t("githubStart.pickRepo")}
                onClick={start}
              >
                {t("githubStart.start")}
              </ActionButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
