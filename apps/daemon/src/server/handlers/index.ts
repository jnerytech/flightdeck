/**
 * Issue #248: every command's handler, by domain. While the split runs, a command not here is
 * still a case of the switch in `server.ts`; at the end this is the whole `Handlers` record.
 */
import type { Handlers } from "../dispatch.ts";

export const HANDLERS: Partial<Handlers> = {};
