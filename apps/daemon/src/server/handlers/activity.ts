/**
 * Issue #1344: the activity domain: what happened on this host since a time, for "While you were
 * away" in Needs you. Read-only, and every list is capped.
 */
import { DEFAULT_ACTIVITY_LIMIT } from "../../activity/since.ts";
import type { Handlers } from "../dispatch.ts";

export const activityHandlers = {
  "activity.since": (payload, { server }) => {
    // The store keeps ISO times with milliseconds and they are compared as text, so `since` takes
    // the same form (a time the app sent without them would sort wrongly at the same instant).
    const since = new Date(payload.since).toISOString();
    return server.need("activity")(since, payload.limit ?? DEFAULT_ACTIVITY_LIMIT);
  },
} satisfies Partial<Handlers>;
