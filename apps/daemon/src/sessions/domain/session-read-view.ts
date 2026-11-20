/** Issue #3514: what `flightdeckd session interrupted|summary|files` print, as pure rules over the daemon's answers. */
import type { InterruptedSession, SessionFile, SessionRecap } from "@flightdeck/protocol";

export const interruptedLines = (_sessions: InterruptedSession[]): string[] => [];
export const recapLines = (_recap: SessionRecap): string[] => [];
export const filesLines = (_files: SessionFile[]): string[] => [];
