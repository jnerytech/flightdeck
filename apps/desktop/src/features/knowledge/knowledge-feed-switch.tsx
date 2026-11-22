import type { KnowledgeFeedState } from "@flightdeck/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AppStore } from "@/lib/app-store";
import { ActionButton } from "@/shared/feedback/index.ts";
import { Inline } from "@/shared/layout/index.ts";

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

  // A press is out until the host answers. State for the busy button, a ref for a second press in the same tick.
  const [sending, setSending] = useState(false);
  const sendingNow = useRef(false);
  // The busy button is disabled, which drops the focus: it comes back once the answer is in.
  const switchButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (sending || !refocus.current) return;
    refocus.current = false;
    switchButton.current?.focus();
  }, [sending]);

  // Bumped by Try again: the read runs again.
  const [reads, setReads] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reads` only asks for another read.
  useEffect(() => {
    let live = true;
    void store.hostCommand(hostId, "knowledge.feed", { path }).then((result) => {
      if (live) received(result);
    });
    return () => {
      live = false;
    };
  }, [store, hostId, path, received, reads]);

  const problem = failed && (
    <p role="alert" className="text-sm">
      {t("projectPage.knowledge.feed.failed")}
    </p>
  );
  // No state to show yet: the alert, and a way to read again.
  if (state === null) {
    if (!failed) return null;
    return (
      <Inline gap={2}>
        {problem}
        <Button type="button" size="sm" variant="outline" onClick={() => setReads((n) => n + 1)}>
          {t("projectPage.knowledge.retry")}
        </Button>
      </Inline>
    );
  }
  const own = state.own;
  const change = async (enabled: boolean) => {
    if (sendingNow.current) return;
    sendingNow.current = true;
    setSending(true);
    const result = await store.hostCommand(hostId, "knowledge.setFeed", { path, enabled });
    received(result);
    refocus.current = true;
    sendingNow.current = false;
    setSending(false);
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
      <output className="block text-sm">{words}</output>
      {(state.on || own) && (
        // The answer is awaited: a second press while it is out is ignored, and the button is busy.
        <ActionButton
          ref={switchButton}
          type="button"
          size="sm"
          variant="outline"
          pending={sending}
          onClick={() => void change(!state.on)}
        >
          {t(state.on ? "projectPage.knowledge.feed.turnOff" : "projectPage.knowledge.feed.turnOn")}
        </ActionButton>
      )}
      {problem}
    </div>
  );
}
