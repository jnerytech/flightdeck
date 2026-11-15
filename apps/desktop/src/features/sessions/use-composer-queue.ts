import type { SessionImage } from "@flightdeck/protocol";
import { useEffect, useRef, useState } from "react";
import { queueStep } from "./domain/composer-queue.ts";
import type { SessionActions } from "./session-actions.ts";

/** A message written during a turn, waiting to go out. */
export interface QueuedMessage {
  text: string;
  images: SessionImage[];
}

/**
 * Messages written during a turn: they wait here and go out, in order, as the turns end, one at a
 * time and only once the one before it has shown up in the conversation.
 */
export function useComposerQueue(input: {
  send: SessionActions["send"];
  working: boolean;
  closed: boolean;
  /** The conversation's cards count: a sent message shows up when it grows. */
  cards: number;
}) {
  const { send, working, closed, cards } = input;
  const [queued, setQueued] = useState<QueuedMessage[]>([]);
  /** A queued message went out and its turn has not shown up yet: the next one waits for it. */
  const awaiting = useRef<number | null>(null);
  const nextQueued = queued[0];
  // biome-ignore lint/correctness/useExhaustiveDependencies: the head of the queue is what it reads
  useEffect(() => {
    const step = queueStep({
      working,
      closed,
      hasNext: nextQueued !== undefined,
      awaiting: awaiting.current,
      cards,
    });
    awaiting.current = step.awaiting;
    if (!step.send || !nextQueued) return;
    void send(nextQueued.text, nextQueued.images.length > 0 ? nextQueued.images : undefined)
      .then(() => setQueued((rest) => rest.slice(1)))
      .catch(() => {
        awaiting.current = null;
      });
  }, [working, closed, nextQueued, cards]);
  return {
    queued,
    enqueue: (message: QueuedMessage) => setQueued((before) => [...before, message]),
    remove: (at: number) => setQueued((before) => before.filter((_, i) => i !== at)),
  };
}
