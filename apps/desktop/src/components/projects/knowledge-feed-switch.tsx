import type { KnowledgeFeedState } from "@flightdeck/protocol";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AppStore } from "@/lib/app-store";

/**
 * Whether the sessions Flightdeck starts in a project are given the index of its valid documents
 * (issue #76), and the switch for it. The switch is the host's `knowledge.feedOff`: a project
 * switched off through a folder above it is switched on there, not here.
 */
export function KnowledgeFeedSwitch(
  props: Readonly<{ store: AppStore; hostId: string; path: string }>,
) {
  const { store, hostId, path } = props;
  const { t } = store.i18n;
  const [state, setState] = useState<KnowledgeFeedState | null>(null);
  // The last answer stays on screen when a later one fails: the person sees what is still true.
  const [failed, setFailed] = useState(false);
  const received = useCallback((result: KnowledgeFeedState | null) => {
    setFailed(result === null);
    if (result) setState(result);
  }, []);

  useEffect(() => {
    let live = true;
    void store.hostCommand(hostId, "knowledge.feed", { path }).then((result) => {
      if (live) received(result);
    });
    return () => {
      live = false;
    };
  }, [store, hostId, path, received]);

  const problem = failed && (
    <p role="alert" className="text-sm">
      {t("projectPage.knowledge.feed.failed")}
    </p>
  );
  if (state === null) return problem || null;
  const own = state.own;
  const change = (enabled: boolean) => {
    void store.hostCommand(hostId, "knowledge.setFeed", { path, enabled }).then(received);
  };
  let words = t("projectPage.knowledge.feed.on");
  if (!state.on) {
    words = own
      ? t("projectPage.knowledge.feed.off")
      : t("projectPage.knowledge.feed.offBy", { path: state.offBy ?? "" });
  } else if (!state.trusted) {
    words = t("projectPage.knowledge.feed.onUntrusted");
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* A live region: a later change of the words (the index on or off) is read out. */}
      <p role="status" className="text-sm">
        {words}
      </p>
      {(state.on || own) && (
        <Button type="button" size="sm" variant="outline" onClick={() => change(!state.on)}>
          {t(state.on ? "projectPage.knowledge.feed.turnOff" : "projectPage.knowledge.feed.turnOn")}
        </Button>
      )}
      {problem}
    </div>
  );
}
