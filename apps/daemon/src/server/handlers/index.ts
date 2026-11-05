/**
 * Issue #248: every command's handler, by domain. While the split runs, a command not here is
 * still a case of the switch in `server.ts`; at the end this is the whole `Handlers` record.
 */
import type { Handlers } from "../dispatch.ts";
import { agentsHandlers } from "./agents.ts";
import { costsHandlers } from "./costs.ts";
import { messagingHandlers } from "./messaging.ts";
import { securityHandlers } from "./security.ts";
import { terminalHandlers } from "./terminal.ts";

/** The domains, by name; no command may sit in two of them (a spread would let the last win). */
export const DOMAINS: Record<string, Partial<Handlers>> = {
  security: securityHandlers,
  agents: agentsHandlers,
  messaging: messagingHandlers,
  terminal: terminalHandlers,
  costs: costsHandlers,
};

export const HANDLERS: Partial<Handlers> = Object.assign({}, ...Object.values(DOMAINS));
