import { type UIEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { missedAfter, rememberPosition, type ScrollPosition } from "./domain/scroll-memory.ts";
import type { SessionState } from "./domain/session-state.ts";

/** Where each conversation was left (by `scrollKey`), so a tab that comes back is where its reader was. */
const positions = new Map<string, ScrollPosition>();
const MAX_POSITIONS = 200;

/** How far from the end still counts as being at the end, in pixels. */
const END_SLACK = 24;
/** How long after the wheel, a key, a touch or a press on the scrollbar a scroll is the person's. */
const PERSON_SCROLL_MS = 600;

interface ConversationScrollInput {
  session: Pick<SessionState, "items" | "streaming">;
  /** The request the screen was opened for: scrolled into view and focused once. */
  focusRequestId?: string | null;
  /** Names this conversation so its scroll position is kept when the person comes back to the tab. */
  scrollKey?: string;
}

/**
 * Where the reader is in a conversation: the view follows the end while they are at it, gives a
 * returning reader their place back, and counts what came while they were up in it.
 */
export function useConversationScroll({
  session,
  focusRequestId,
  scrollKey,
}: Readonly<ConversationScrollInput>) {
  const timeline = useRef<HTMLDivElement>(null);
  const cards = session.items.length;
  // Whether the reader is at the end: only then does a new message, or the layout settling, pull the view down.
  const following = useRef(!focusRequestId);
  // The last message the reader had seen when they left the end: what came after is "new".
  const [awaySeq, setAwaySeq] = useState<number | null>(null);
  const away = awaySeq !== null;
  const streaming = session.streaming;
  const lastSeq = session.items.at(-1)?.seq ?? 0;
  const firstSeq = session.items[0]?.seq ?? 0;
  const lastHeight = useRef(0);
  // Where the view itself last put the scroll: the scroll event of that move says nothing about the
  // reader, and by the time it is delivered the layout may have grown (a panel, a code block).
  const pinnedTop = useRef<number | null>(null);
  /** The place a returning reader asked for, until the layout has the height to hold it (issue #515). */
  const restoring = useRef<number | null>(null);
  // Until when a scroll is the person's: their wheel, keys, touch or a press on the scrollbar. The
  // browser also scrolls by itself (it pulls the position back when the content shrinks), and the
  // event for that can reach the handler after a panel changed the layout: read then, the view
  // would look away from the end and stop following it (issue #315).
  const personUntil = useRef(0);
  const person = () => {
    personUntil.current = Date.now() + PERSON_SCROLL_MS;
  };
  const pin = (box: HTMLElement) => {
    box.scrollTop = box.scrollHeight;
    // Issue #456: the end, but never past a pending request's top. When the conversation is about
    // as tall as the card (a short window, a long header), the card's question comes first. An
    // answered card keeps its request id and says nothing of the end (#3407).
    const card = box.querySelector('[data-request-id][data-state="waiting"]');
    const cut = card ? box.getBoundingClientRect().top - card.getBoundingClientRect().top : 0;
    if (cut > 0) box.scrollTop -= cut;
    pinnedTop.current = box.scrollTop;
  };
  const lastFirst = useRef(firstSeq);
  const lastSeqRef = useRef(lastSeq);
  lastSeqRef.current = lastSeq;
  // Coming back to a conversation: a reader who was up in it gets their place back, one who was at
  // the end gets the end (which the observer below keeps while the layout settles).
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on the first render of this conversation
  useLayoutEffect(() => {
    const box = timeline.current;
    const saved = scrollKey ? positions.get(scrollKey) : undefined;
    if (!box || !saved || saved.atEnd) return;
    following.current = false;
    restoring.current = saved.top;
    box.scrollTop = saved.top;
    setAwaySeq(saved.seq);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new message or token is when the end moves
  useLayoutEffect(() => {
    const box = timeline.current;
    if (!box) return;
    if (following.current) pin(box);
    else if (firstSeq < lastFirst.current) {
      // Older messages came in above what is being read: the view stays on the same message.
      box.scrollTop += box.scrollHeight - lastHeight.current;
    }
    lastFirst.current = firstSeq;
    lastHeight.current = box.scrollHeight;
  }, [cards, streaming]);
  // Images, code blocks and panels settle after the first paint and push the end down: while the
  // reader is at the end, the view follows it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: new messages add elements to observe
  useLayoutEffect(() => {
    const box = timeline.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      // The content got taller: the place a returning reader asked for may fit now.
      if (restoring.current !== null) {
        box.scrollTop = restoring.current;
        if (box.scrollTop === restoring.current) restoring.current = null;
      } else if (following.current) pin(box);
      lastHeight.current = box.scrollHeight;
    });
    observer.observe(box);
    for (const child of Array.from(box.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [cards]);
  // The request the screen was opened for: in view, and once found, focused, so A and N answer it
  // with no click first (#187). Only once: a card arriving later never takes the focus from the box.
  const focusedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!focusRequestId || cards === 0) return;
    const card = timeline.current?.querySelector<HTMLElement>(
      `[data-request-id="${focusRequestId}"]`,
    );
    // The whole card, as little scroll as needed: centered, a tall card near the end was cut.
    card?.scrollIntoView?.({ block: "nearest" });
    if (card && focusedFor.current !== focusRequestId) {
      focusedFor.current = focusRequestId;
      card.focus({ preventScroll: true });
    }
  }, [focusRequestId, cards]);
  const missed = missedAfter(session.items, awaySeq);
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const box = e.currentTarget;
    const own = pinnedTop.current === box.scrollTop;
    pinnedTop.current = null;
    if (own && following.current) return;
    // A restore the layout has not held yet: the browser's clamp is not the reader going to
    // the end, and the place kept stays as it was. The person's own scroll ends the restore.
    if (restoring.current !== null) {
      if (Date.now() < personUntil.current || box.scrollTop === restoring.current)
        restoring.current = null;
      else return;
    }
    const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight <= END_SLACK;
    // Following and not at the end, with no hand on it: the layout moved, not the person.
    // The observer pins the end again.
    if (following.current && !atEnd && Date.now() >= personUntil.current) return;
    following.current = atEnd;
    lastHeight.current = box.scrollHeight;
    // Leaving the end remembers the last message seen; returning to it forgets that.
    setAwaySeq((seen) => (atEnd ? null : (seen ?? lastSeqRef.current)));
    if (scrollKey)
      rememberPosition(
        positions,
        scrollKey,
        { top: box.scrollTop, atEnd, seq: lastSeqRef.current },
        MAX_POSITIONS,
      );
  };
  /** The "jump to latest" button: the end, following again, and no place kept. */
  const jumpToEnd = () => {
    const box = timeline.current;
    if (box) box.scrollTop = box.scrollHeight;
    following.current = true;
    setAwaySeq(null);
    if (scrollKey) positions.delete(scrollKey);
  };
  const handlers = {
    onWheel: person,
    onTouchStart: person,
    onTouchMove: person,
    onKeyDown: person,
    onPointerDown: person,
    onScroll,
  };
  return { timeline, away, missed, handlers, jumpToEnd };
}
