import type { AutoApproveSettings, PrProviderKind } from "@flightdeck/protocol";

// The board's shapes are the protocol's: what the daemon stores is what goes on the wire.
export type {
  BoardColumn,
  Card,
  CardDiff,
  CardRun,
  ChecksState,
  DiffFile,
  DiffHunk,
  DiffLine,
  Project,
  PrProviderKind,
  PrState,
} from "@flightdeck/protocol";

export interface NewProject {
  path: string;
  name?: string | undefined;
  baseBranch?: string | undefined;
  prProvider?: PrProviderKind | undefined;
  setupScript?: string | null | undefined;
  promptTemplate?: string | undefined;
  /** Phase 13: fields left out keep their value (or the default). */
  autoApprove?: Partial<AutoApproveSettings> | undefined;
}

export type ProjectPatch = Partial<Omit<NewProject, "path">>;
