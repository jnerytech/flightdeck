/**
 * Issue #1288: the commands that change the host: end an orphan process, install the service, add
 * an allowed root, and set how the host presents itself.
 */
import type { Handlers } from "../dispatch.ts";

export const hostChangesHandlers = {} satisfies Partial<Handlers>;
