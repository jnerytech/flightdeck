/**
 * Issue #1288: the PR comments domain: a card's PR review comments, and sending them to its session.
 */
import type { Handlers } from "../dispatch.ts";

export const prCommentsHandlers = {} satisfies Partial<Handlers>;
