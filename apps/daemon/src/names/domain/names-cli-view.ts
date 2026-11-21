/**
 * Issue #3735: what `flightdeckd names list` prints, as pure rules over the daemon's answer.
 */
import type { SessionNameInfo } from "@flightdeck/protocol";

export const namesJson = (_names: SessionNameInfo[]): Record<string, unknown>[] => [];

export const namesLines = (_names: SessionNameInfo[]): string[] => [];
