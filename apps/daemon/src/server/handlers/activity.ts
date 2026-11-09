/**
 * Issue #1344: the activity domain: what happened on this host since a time, for "While you were
 * away" in Needs you. Read-only, and every list is capped.
 */
import { DEFAULT_ACTIVITY_LIMIT } from "../../activity/since.ts";
import type { Handlers } from "../dispatch.ts";

export const activityHandlers = {
  "activity.since": (payload, { server }) => {
    return server.need("activity")(payload.since, payload.limit ?? DEFAULT_ACTIVITY_LIMIT);
  },
} satisfies Partial<Handlers>;
