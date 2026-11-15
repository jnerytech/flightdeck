import type {
  EffortLevel,
  PermissionUpdate,
  SessionImage,
  SettableMode,
} from "@flightdeck/protocol";

/** What goes with an answer to a request, besides allow or deny: the shape of `Answer` in features/needs-you/domain/pending-item.ts, which documents each field. */
interface SessionAnswer {
  updatedPermissions?: PermissionUpdate[];
  message?: string;
  updatedInput?: Record<string, unknown>;
  held?: boolean;
}

export interface SessionActions {
  /** Copies a text (the approval's folder); the store's `sessionActions` does. */
  copyText?(text: string): Promise<boolean>;
  send(text: string, images?: SessionImage[]): Promise<void>;
  /** Changes the permission mode / the model (null: the default) of the open session. */
  /** False when the host refused the mode (#935): the picker goes back to the session's own. */
  setMode?(mode: SettableMode): Promise<unknown>;
  setModel?(model: string | null): Promise<void>;
  /** Changes the effort of the live session; null is the model's default. */
  setEffort?(effort: EffortLevel | null): Promise<void>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
  resume(): Promise<void>;
  respond(requestId: string, decision: "allow" | "deny", answer?: SessionAnswer): Promise<void>;
}
