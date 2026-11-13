import { useEffect, useMemo, useState } from "react";
import { CheckpointsButton } from "@/features/checkpoints/ui.ts";
import { FolderPicker } from "@/features/hosts/ui.ts";
import { PersonaSwitch } from "@/features/personas/ui.ts";
import { EarlierTurns } from "@/features/sessions/earlier-turns";
import { RecapPanel } from "@/features/summary/ui.ts";
import { TerminalButton } from "@/features/terminal/ui.ts";
import { UntrustedNotice } from "@/features/trust/ui.ts";
import { basename, holdsFolder, isBusy } from "@/shared/lib/index.ts";
import { type AppState, type AppStore, type HostView, sessionKey } from "../../lib/app-store.ts";
import type { Route } from "../../lib/router.ts";
import { useSessionState } from "../../lib/use-store.ts";
import { hasFeature } from "../../lib/version.ts";
import { CacheTimer } from "./cache-timer";
import { sessionTabOffers, useSessionCost } from "./index.ts";
import { SessionTabs } from "./session-tabs.tsx";
import { SessionView } from "./session-view.tsx";

/** The folder picker the composer opens to mention a file or folder of the host; none once it is gone. */
const pathPicker =
  (store: AppStore, host: HostView | undefined) => (done: (path: string | null) => void) =>
    host && (
      <FolderPicker
        store={store}
        host={host}
        files={hasFeature(host.hostInfo?.features, "fs.files", false)}
        onPick={(path) => done(path)}
        onClose={() => done(null)}
      />
    );

/** The pin of a session: stable between renders, so the finished messages of a long conversation are not drawn again. */
function usePin(
  store: AppStore,
  hostId: string,
  claudeId: string | null | undefined,
  pinned: boolean,
) {
  return useMemo(
    () =>
      claudeId
        ? {
            pinned,
            toggle: () => void store.sessionLists.setMeta(hostId, claudeId, { pinned: !pinned }),
          }
        : undefined,
    [store, hostId, claudeId, pinned],
  );
}

/** Fork from here: a new session from the transcript, opened where it started; none without a transcript or the feature. */
function useFork(
  store: AppStore,
  hostId: string,
  claudeId: string | null | undefined,
  canFork: boolean,
  cwd: string,
) {
  return useMemo(
    () =>
      claudeId && canFork
        ? () =>
            void store
              .hostCommand(hostId, "session.fork", {
                claudeSessionId: claudeId,
                cwd,
                open: "flightdeck",
              })
              .then((result) => {
                if (result?.sessionId) {
                  store.router.push({ name: "session", host: hostId, id: result.sessionId });
                }
              })
        : undefined,
    [store, hostId, claudeId, canFork, cwd],
  );
}

/** A managed session's conversation; selecting it subscribes to its full event stream. */
export function ManagedSession(
  props: Readonly<{
    store: AppStore;
    state: Pick<AppState, "hosts" | "selected" | "hub" | "meta" | "projects" | "composerFill">;
    hostId: string;
    sessionId: string;
    focus: string | null;
    /** Opens the host's page (the mode menu links to the bypass switch there). */
    go(route: Route): void;
  }>,
) {
  const { store, state, hostId, sessionId } = props;
  const host = state.hosts.find((h) => h.id === hostId);
  useEffect(() => {
    if (state.selected?.hostId !== hostId || state.selected.sessionId !== sessionId) {
      store.subscriptions.select(hostId, sessionId);
    }
  }, [store, state.selected, hostId, sessionId]);
  const summary = host?.sessions.find((s) => s.id === sessionId);
  const session = useSessionState(store, sessionKey(hostId, sessionId));
  const opencode = summary?.runtime === "opencode";
  const openCodeModels = useOpenCodeModels(store, hostId, opencode);
  // Estimated cost of the session, once its claudeSessionId is known (phase 8): from its own
  // events, else from the Sessões list.
  const claudeId =
    session.claudeSessionId ??
    state.hub[hostId]?.managed.find((s) => s.id === sessionId)?.claudeSessionId;
  const withCosts = hasFeature(host?.hostInfo?.features, "costs", false);
  const status = session.status;
  const pinned = claudeId ? state.meta[`${hostId}/${claudeId}`]?.pinned === true : false;
  const cwd = summary?.cwd ?? session.cwd ?? "";
  // The project the folder belongs to, where the person can read what it would load and trust it.
  const owner = state.projects[hostId]?.find((p) => holdsFolder(p.path, cwd));
  const canFork = hasFeature(host?.hostInfo?.features, "checkpoints", false);
  const pin = usePin(store, hostId, claudeId, pinned);
  const fork = useFork(store, hostId, claudeId, canFork, cwd);
  const costUsd = useSessionCost(store, hostId, claudeId, withCosts, status);
  return (
    <SessionTabs
      store={store}
      hostId={hostId}
      viewKey={sessionKey(hostId, sessionId)}
      claudeSessionId={claudeId}
      // This page's message box takes a review handed over from Changes.
      reviewToComposer
      {...sessionTabOffers(host, opencode, sessionId, store.terminals.embedded(hostId))}
    >
      <SessionView
        t={store.i18n.t}
        nowMs={store.now()}
        {...(hasFeature(host?.hostInfo?.features, "snippets", false)
          ? { prompts: store.snippets.prompts(hostId, summary?.cwd ?? session.cwd ?? "") }
          : {})}
        title={summary?.name ?? basename(summary?.cwd ?? session.cwd ?? sessionId)}
        scrollKey={sessionKey(hostId, sessionId)}
        composerFill={state.composerFill[sessionKey(hostId, sessionId)] ?? null}
        onComposerFilled={() => store.takeComposerFill(sessionKey(hostId, sessionId))}
        session={session}
        actions={store.sessionActions}
        cache={
          <CacheTimer store={store} since={summary?.status === "idle" ? summary.updatedAt : null} />
        }
        {...(pin ? { pin } : {})}
        {...(fork ? { fork } : {})}
        {...(summary?.runtime ? { runtime: summary.runtime } : {})}
        {...(openCodeModels ? { models: openCodeModels } : {})}
        {...(claudeId && !opencode && hasFeature(host?.hostInfo?.features, "review", false)
          ? {
              // #1133: End first asks about the files the session's checkout did not commit.
              uncommitted: async () => {
                const found = await store.hostRequest(hostId, "changes.get", {
                  target: `session:${claudeId}`,
                });
                return found.ok ? found.data.files.length : 0;
              },
              onCommitFirst: () => {
                store.sessionViews.select("changes");
              },
            }
          : {})}
        settings={hasFeature(host?.hostInfo?.features, "session.settings", false)}
        effort={hasFeature(host?.hostInfo?.features, "session.effort", false)}
        onOpenHostSettings={() => props.go({ name: "host", host: hostId })}
        {...(host?.hostInfo?.allowBypassPermissions === true
          ? { bypass: { host: host.name } }
          : {})}
        images={hasFeature(host?.hostInfo?.features, "session.images", false)}
        pickPath={pathPicker(store, host)}
        focusRequestId={props.focus}
        assist={{
          controller: store.assistant,
          kind: "prompt",
          fieldHostId: hostId,
          ...(cwd ? { cwd } : {}),
          openSettings: () => props.go({ name: "settings", section: "assistant" }),
        }}
        {...(session.resumedFrom
          ? {
              earlier: (
                <EarlierTurns store={store} hostId={hostId} claudeSessionId={session.resumedFrom} />
              ),
            }
          : {})}
        recap={
          <>
            <UntrustedNotice
              store={store}
              hostId={hostId}
              announced={hasFeature(host?.hostInfo?.features, "projectTrust", false)}
              cwd={cwd}
              sessionId={sessionId}
              {...(summary?.trustStale ? { stale: true } : {})}
              {...(owner
                ? {
                    onReview: () =>
                      store.router.push({ name: "project", host: hostId, projectId: owner.id }),
                  }
                : {})}
            />
            {claudeId && (
              <RecapPanel
                store={store}
                hostId={hostId}
                claudeSessionId={claudeId}
                stamp={status}
                {...(owner?.path || cwd ? { libraryPath: owner?.path || cwd } : {})}
              />
            )}
          </>
        }
        alwaysAllow={hasFeature(host?.hostInfo?.features, "rules", false)}
        terminal={
          // Only once Claude Code named the session: there is nothing to resume before that.
          session.claudeSessionId && (
            <TerminalButton
              store={store}
              hostId={hostId}
              target={{
                cwd: summary?.cwd ?? session.cwd ?? "",
                claudeSessionId: session.claudeSessionId,
              }}
            />
          )
        }
        timeline={
          hasFeature(host?.hostInfo?.features, "checkpoints", false) &&
          session.claudeSessionId && (
            <CheckpointsButton
              store={store}
              hostId={hostId}
              claudeSessionId={session.claudeSessionId}
              cwd={summary?.cwd ?? session.cwd ?? ""}
              busy={isBusy(session.status)}
            />
          )
        }
        persona={
          hasFeature(host?.hostInfo?.features, "personas", false) && (
            <PersonaSwitch
              store={store}
              hostId={hostId}
              target={{ sessionId }}
              current={
                session.persona ??
                state.hub[hostId]?.managed.find((s) => s.id === sessionId)?.persona ??
                null
              }
            />
          )
        }
        costUsd={costUsd}
      />
    </SessionTabs>
  );
}

/** Phase 39: the host's OpenCode models, for an OpenCode session's live switch; null until known. */
function useOpenCodeModels(store: AppStore, hostId: string, opencode: boolean): string[] | null {
  const [models, setModels] = useState<string[] | null>(null);
  useEffect(() => {
    if (!opencode) return;
    let live = true;
    void store.hostRequest(hostId, "runtime.models", { runtime: "opencode" }).then((result) => {
      if (live) setModels(result.ok ? result.data.models.map((m) => m.id) : []);
    });
    return () => {
      live = false;
    };
  }, [store, hostId, opencode]);
  return opencode ? models : null;
}
